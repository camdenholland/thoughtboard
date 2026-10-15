import type { Note } from "./notes";
import { requireSupabase } from "./supabase";
export const SORT_OPTIONS = [
  ["manual", "Manual order"],
  ["newest", "Date created · newest first"],
  ["oldest", "Date created · oldest first"],
  ["az", "Alphabetical · A–Z"],
  ["za", "Alphabetical · Z–A"],
] as const;
export type SortMode = (typeof SORT_OPTIONS)[number][0];
export type BoardLayout = {
  order: string[];
  sort: SortMode;
  revision: number | null;
};
export const EMPTY_LAYOUT: BoardLayout = {
  order: [],
  sort: "manual",
  revision: null,
};
const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});
function label(note: Note) {
  return (
    note.title.trim() ||
    note.content
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/[*_~`#>\[\]]/g, "")
      .trim()
  );
}
export function sortNotes(notes: Note[], layout: BoardLayout): Note[] {
  const result = [...notes];
  const rank = new Map(layout.order.map((id, index) => [id, index]));
  result.sort((a, b) => {
    if (layout.sort === "manual") {
      const diff = (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity);
      if (!Number.isNaN(diff) && diff !== 0) return diff;
      return (
        (a.createdAt ? Date.parse(a.createdAt) : 0) -
          (b.createdAt ? Date.parse(b.createdAt) : 0) ||
        a.id.localeCompare(b.id)
      );
    }
    if (layout.sort === "az" || layout.sort === "za")
      return (
        (layout.sort === "az" ? 1 : -1) *
          collator.compare(label(a), label(b)) || a.id.localeCompare(b.id)
      );
    // Unknown legacy dates belong at the end in both date views.
    if (!a.createdAt || !b.createdAt)
      return a.createdAt ? -1 : b.createdAt ? 1 : a.id.localeCompare(b.id);
    return (
      (layout.sort === "newest" ? -1 : 1) *
        (Date.parse(a.createdAt) - Date.parse(b.createdAt)) ||
      a.id.localeCompare(b.id)
    );
  });
  return result;
}
export function mergeVisibleOrder(all: string[], visible: string[]): string[] {
  const set = new Set(visible);
  let next = 0;
  return all.map((id) => (set.has(id) ? visible[next++] : id));
}
export function shortestColumns(heights: number[], columns: number, gap = 16) {
  const totals = Array(columns).fill(0) as number[];
  const positions = heights.map((height) => {
    let column = 0;
    for (let i = 1; i < columns; i++)
      if (totals[i] < totals[column]) column = i;
    const top = totals[column];
    totals[column] += height + gap;
    return { column, top };
  });
  return {
    positions,
    height: Math.max(0, ...totals) - (heights.length ? gap : 0),
  };
}
export async function fetchLayout(userId: string): Promise<BoardLayout> {
  const { data, error } = await requireSupabase()
    .from("thoughtboard_layout")
    .select("ordered_ids,sort_mode,revision")
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new Error(
      "Board settings could not be loaded. Run supabase/board-layout.sql, then Refresh.",
    );
  return data
    ? { order: data.ordered_ids, sort: data.sort_mode, revision: data.revision }
    : { ...EMPTY_LAYOUT };
}
export async function saveLayout(
  userId: string,
  next: BoardLayout,
): Promise<BoardLayout> {
  const db = requireSupabase();
  const payload = {
    user_id: userId,
    ordered_ids: next.order,
    sort_mode: next.sort,
  };
  const query =
    next.revision === null
      ? db.from("thoughtboard_layout").insert(payload)
      : db
          .from("thoughtboard_layout")
          .update(payload)
          .eq("user_id", userId)
          .eq("revision", next.revision);
  const { data, error } = await query.select("revision").maybeSingle();
  if (error || !data)
    throw new Error(
      error?.code === "23505" || !error
        ? "Board order changed elsewhere. Refresh before organizing again."
        : "Could not save board order. Check your connection and database setup.",
    );
  return { ...next, revision: data.revision };
}
