import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = (text) => createHash("sha256").update(text).digest();
const reply = (status, body, headers = {}) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...headers },
});

// Server-only Vercel function. Never import this file into src/.
export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return reply(405, { ok: false, error: "Use POST to add a thought." }, { Allow: "POST" });
    }
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SECRET_KEY?.trim();
    const owner = process.env.THOUGHTBOARD_USER_ID?.trim();
    const token = process.env.CAPTURE_TOKEN?.trim();
    if (!url || !key || !owner || !uuid.test(owner) || !token || token.length < 32) {
      return reply(500, { ok: false, error: "Capture is not configured on the server." });
    }
    const supplied = request.headers.get("authorization") ?? "";
    if (!timingSafeEqual(digest(supplied), digest(`Bearer ${token}`))) {
      return reply(401, { ok: false, error: "Invalid capture token." });
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return reply(415, { ok: false, error: "Send a JSON request body." });
    }
    let body;
    try {
      const raw = await request.text();
      if (Buffer.byteLength(raw, "utf8") > 100000) return reply(413, { ok: false, error: "Request is too large." });
      body = JSON.parse(raw);
    } catch {
      return reply(400, { ok: false, error: "Invalid JSON." });
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.content !== "string") {
      return reply(400, { ok: false, error: "Provide content as text." });
    }
    const content = body.content.trim();
    if (!content || content.length > 20000) {
      return reply(400, { ok: false, error: "Enter between 1 and 20,000 characters." });
    }
    if (body.requestId !== undefined && (typeof body.requestId !== "string" || !uuid.test(body.requestId))) {
      return reply(400, { ok: false, error: "requestId must be a UUID." });
    }
    // Extract standalone hashtags before removing them from the note body.
    const tags = [...new Set([...content.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)]
      .map(match => match[1].toLowerCase()))];
    if (tags.length > 50 || tags.some(tag => tag.length > 50)) {
      return reply(400, { ok: false, error: "Use at most 50 tags, each at most 50 characters." });
    }
    // Whitespace is a boundary, not part of the match, so adjacent tags work.
    // Preserve line breaks, Markdown headings, and URL fragments.
    const noteContent = content.replace(/(?<!\S)#[\p{L}\p{N}_-]+[ \t]*/gu, "").trim();
    if (!noteContent) {
      return reply(400, { ok: false, error: "Add some note text along with your hashtags." });
    }
    const id = `shortcut:${(body.requestId ?? randomUUID()).toLowerCase()}`;
    try {
      const db = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
      });
      // Secret keys bypass RLS, so enforce board membership explicitly.
      const membership = await db.from("thoughtboard_members").select("user_id").eq("user_id", owner).maybeSingle();
      if (membership.error) throw membership.error;
      if (!membership.data) return reply(403, { ok: false, error: "The configured account does not have board access." });
      const { error } = await db.from("thoughtboard_notes").upsert({
        user_id: owner, id, title: "", content: noteContent,
        tags: tags.filter(tag => tag !== "private"),
        is_private: tags.includes("private"), note_date: null,
        created_at: new Date().toISOString(),
      }, { onConflict: "user_id,id", ignoreDuplicates: true });
      if (error) throw error;
      return reply(200, { ok: true, id, message: "Thought saved." });
    } catch {
      // Do not return database details or log note content / credentials.
      return reply(502, { ok: false, error: "Could not save the thought. Check the server configuration or try again." });
    }
  },
};
