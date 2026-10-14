export type Note = {
  revision?: number;
  id: string;
  title: string;
  content: string;
  tags: string[];
  isPrivate: boolean;
  createdAt: string | null;
  noteDate: string | null;
};

// Keep the original key so existing notes survive this update.
export const STORAGE_KEY = "thought-board-notes";

export function normalizeTags(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map((tag) => tag.trim().replace(/^#+/, "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function loadNotes(): { notes: Note[]; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { notes: [], error: "" };
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("Invalid notes");

    const notes = value.map((item: unknown): Note => {
      if (!item || typeof item !== "object") throw new Error("Invalid note");
      const note = item as Record<string, unknown>;
      if (
        typeof note.id !== "string" ||
        typeof note.title !== "string" ||
        typeof note.content !== "string"
      ) {
        throw new Error("Invalid note");
      }
      const tags = normalizeTags(
        Array.isArray(note.tags)
          ? note.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
      );
      return {
        id: note.id,
        title: note.title,
        content: note.content,
        tags: tags.filter((tag) => tag !== "private"),
        isPrivate: note.isPrivate === true || tags.includes("private"),
        createdAt:
          typeof note.createdAt === "string" &&
          !Number.isNaN(Date.parse(note.createdAt))
            ? note.createdAt
            : null,
        noteDate:
          typeof note.noteDate === "string" && isValidDay(note.noteDate)
            ? note.noteDate
            : null,
      };
    });
    return { notes, error: "" };
  } catch {
    return {
      notes: [],
      error:
        "Your saved notes could not be loaded. They have not been overwritten. Keep your browser data and resolve this before editing.",
    };
  }
}

export function isValidDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDay(date) === value;
}

function localDay(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatNoteDate(day: string): string {
  // A calendar day is not a UTC instant: parse it in the local timezone.
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatCreatedAt(value: string | null): string {
  if (!value) return "Earlier note";
  const date = new Date(value);
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

function dateSearchText(day: string): string {
  const date = new Date(`${day}T12:00:00`);
  return `${day} ${formatNoteDate(day)} ${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
}

export function getVisibleNotes(
  notes: Note[],
  showPrivate: boolean,
  tags: string[],
  query = "",
  noteDate = "",
): Note[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return notes.filter((note) => {
    if (note.isPrivate && !showPrivate) return false;
    const searchable = [
      note.title,
      note.content,
      ...note.tags,
      note.noteDate ? dateSearchText(note.noteDate) : "",
      note.createdAt ? dateSearchText(localDay(new Date(note.createdAt))) : "",
    ]
      .join(" ")
      .toLowerCase();
    return (
      (tags.length === 0 || tags.some((tag) => note.tags.includes(tag))) &&
      (!noteDate || note.noteDate === noteDate) &&
      terms.every((term) => searchable.includes(term))
    );
  });
}
