import type { Note } from "./notes";
import { requireSupabase, errorMessage } from "./supabase";
import { migrateLocalImages } from "./images";

const TABLE = "thoughtboard_notes";
const fields = "id,title,content,tags,is_private,note_date,created_at,revision";
type Row = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  is_private: boolean;
  note_date: string | null;
  created_at: string | null;
  revision: number;
};
function fromRow(row: Row): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: row.tags,
    isPrivate: row.is_private,
    noteDate: row.note_date,
    createdAt: row.created_at,
    revision: row.revision,
  };
}
function toRow(note: Note, userId: string) {
  return {
    id: note.id,
    user_id: userId,
    title: note.title,
    content: note.content,
    tags: note.tags,
    is_private: note.isPrivate,
    note_date: note.noteDate,
    created_at: note.createdAt,
  };
}

export async function fetchNotes(userId: string): Promise<Note[]> {
  const result: Note[] = [];
  const db = requireSupabase();
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db
      .from(TABLE)
      .select(fields)
      .eq("user_id", userId)
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("inserted_at", { ascending: false })
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error(error.message);
    result.push(...(data as Row[]).map(fromRow));
    if (data.length < 500) return result;
  }
}

export async function saveCloudNote(note: Note, userId: string): Promise<Note> {
  const db = requireSupabase();
  const payload = toRow(note, userId);
  const request =
    note.revision === undefined
      ? db.from(TABLE).insert(payload)
      : db
          .from(TABLE)
          .update(payload)
          .eq("user_id", userId)
          .eq("id", note.id)
          .eq("revision", note.revision);
  const { data, error } = await request.select(fields).maybeSingle();
  if (error)
    throw new Error(
      error.code === "23505"
        ? "This note may already have been saved. Copy your draft, close the editor, and refresh before retrying."
        : error.message,
    );
  if (!data)
    throw new Error(
      "This note changed or was deleted on another device. Copy your draft, close the editor, and refresh before editing again.",
    );
  return fromRow(data as Row);
}

export async function deleteCloudNote(
  note: Note,
  userId: string,
): Promise<void> {
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("id", note.id)
    .eq("revision", note.revision ?? 0)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error(
      "This note changed or was deleted on another device. Close the editor and refresh before trying again.",
    );
}

export type ImportResult = {
  imported: number;
  skipped: number;
  failures: { id: string; message: string }[];
};
export async function importLocalNotes(
  local: Note[],
  userId: string,
  onProgress: (done: number, total: number) => void,
): Promise<ImportResult> {
  const db = requireSupabase();
  const existing = new Set((await fetchNotes(userId)).map((note) => note.id));
  const result: ImportResult = { imported: 0, skipped: 0, failures: [] };
  let done = 0;
  // Import old notes first so insertion order preserves the local newest-first order.
  for (const note of [...local].reverse()) {
    try {
      if (existing.has(note.id)) result.skipped++;
      else {
        const content = await migrateLocalImages(note.content, userId);
        const { data, error } = await db
          .from(TABLE)
          .upsert(toRow({ ...note, content }, userId), {
            onConflict: "user_id,id",
            ignoreDuplicates: true,
          })
          .select("id");
        if (error) throw error;
        if (data.length) result.imported++;
        else result.skipped++;
      }
    } catch (reason) {
      result.failures.push({ id: note.id, message: errorMessage(reason) });
    }
    onProgress(++done, local.length);
  }
  return result;
}
