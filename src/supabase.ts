import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const supabase = url && key ? createClient(url, key) : null;

export function requireSupabase() {
  if (!supabase)
    throw new Error(
      "Supabase is not configured. Check .env.local and restart Vite.",
    );
  return supabase;
}

export function errorMessage(reason: unknown): string {
  if (
    reason &&
    typeof reason === "object" &&
    "message" in reason &&
    typeof reason.message === "string"
  )
    return reason.message;
  return "The request failed. Check your connection and try again.";
}
