import { useCallback, useEffect, useRef, useState } from "react";
import MasonryBoard from "./MasonryBoard";
import {
  EMPTY_LAYOUT,
  SORT_OPTIONS,
  fetchLayout,
  saveLayout,
  sortNotes,
  mergeVisibleOrder,
} from "./boardLayout";
import type { BoardLayout, SortMode } from "./boardLayout";
import NoteEditor from "./NoteEditor";
import Icon from "./Icons";
import { getVisibleNotes, loadNotes } from "./notes";
import type { Note } from "./notes";
import { tagStyle } from "./tagColors";
import {
  fetchNotes,
  saveCloudNote,
  deleteCloudNote,
  importLocalNotes,
} from "./cloudNotes";
import { requireSupabase, errorMessage } from "./supabase";
import "./App.css";

export default function Board({ userId }: { userId: string }) {
  const [initial] = useState(loadNotes);
  const [notes, setNotes] = useState<Note[]>([]);
  const [layout, setLayout] = useState<BoardLayout>(EMPTY_LAYOUT);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const [organizing, setOrganizing] = useState(false);
  const organizingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const importKey = `thoughtboard-import:${import.meta.env.VITE_SUPABASE_URL}:${userId}`;
  const [importComplete, setImportComplete] = useState(() => {
    try {
      return localStorage.getItem(importKey) === "done";
    } catch {
      return false;
    }
  });
  const alive = useRef(false);
  const requestVersion = useRef(0);
  const [saveError, setSaveError] = useState("");
  const [status, setStatus] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [editor, setEditor] = useState<{ note: Note; isNew: boolean } | null>(
    null,
  );
  const [showPrivate, setShowPrivate] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  const accessibleNotes = notes.filter(
    (note) => showPrivate || !note.isPrivate,
  );
  const availableTags = [
    ...new Set(accessibleNotes.flatMap((note) => note.tags)),
  ].sort();
  const activeTags = selectedTags.filter((tag) => availableTags.includes(tag));
  const orderedNotes = sortNotes(notes, layout);
  const visibleNotes = getVisibleNotes(
    orderedNotes,
    showPrivate,
    activeTags,
    query,
    dateFilter,
  );
  const hasFilters =
    activeTags.length > 0 || query.trim() !== "" || dateFilter !== "";

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !editor
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [editor]);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const [next, preferences] = await Promise.all([
        fetchNotes(userId),
        fetchLayout(userId)
          .then((value) => ({ value, error: "" }))
          .catch((reason) => ({ value: null, error: errorMessage(reason) })),
      ]);
      if (alive.current && version === requestVersion.current) {
        setNotes(next);
        if (preferences.value) setLayout(preferences.value);
        setLayoutReady(!!preferences.value);
        setLayoutError(preferences.error);
        setReady(true);
        setSaveError("");
      }
    } catch (reason) {
      if (alive.current && version === requestVersion.current)
        setSaveError(errorMessage(reason));
    } finally {
      if (alive.current && version === requestVersion.current)
        setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      requestVersion.current++;
    };
  }, [refresh]);

  useEffect(() => {
    if (!importing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [importing]);

  async function runImport() {
    if (importing || loading || initial.error) return;
    setImporting(true);
    setSaveError("");
    try {
      const result = await importLocalNotes(
        initial.notes,
        userId,
        (done, total) => {
          if (alive.current) setStatus(`Importing ${done} of ${total}…`);
        },
      );
      const next = await fetchNotes(userId);
      if (!alive.current) return;
      setNotes(next);
      setStatus(
        `Imported ${result.imported}; already saved ${result.skipped}. Local copies were kept.`,
      );
      if (result.failures.length) {
        setSaveError(
          `${result.failures.length} notes could not be imported. ${result.failures[0].message} You can retry without duplicating saved notes.`,
        );
      } else {
        setImportComplete(true);
        try {
          localStorage.setItem(importKey, "done");
        } catch {
          /* Retry remains harmless. */
        }
      }
    } catch (reason) {
      if (alive.current) setSaveError(errorMessage(reason));
    } finally {
      if (alive.current) setImporting(false);
    }
  }

  async function signOut() {
    try {
      const { error } = await requireSupabase().auth.signOut({
        scope: "local",
      });
      if (error) throw error;
    } catch (reason) {
      setSaveError(errorMessage(reason));
    }
  }

  async function organize(next: BoardLayout) {
    if (organizingRef.current || !layoutReady || loading || importing) return;
    const previous = layout;
    organizingRef.current = true;
    setOrganizing(true);
    setLayout(next);
    setLayoutError("");
    try {
      const saved = await saveLayout(userId, next);
      if (alive.current) {
        setLayout(saved);
        setStatus("Board order saved.");
      }
    } catch (reason) {
      if (alive.current) {
        setLayout(previous);
        setLayoutError(errorMessage(reason));
      }
    } finally {
      organizingRef.current = false;
      if (alive.current) setOrganizing(false);
    }
  }

  function addNote() {
    setEditor({
      isNew: true,
      note: {
        id: crypto.randomUUID(),
        title: "",
        content: "",
        tags: [...activeTags],
        isPrivate: false,
        createdAt: new Date().toISOString(),
        noteDate: dateFilter || null,
      },
    });
  }

  async function saveNote(updated: Note): Promise<void> {
    const saved = await saveCloudNote(updated, userId);
    if (!alive.current) return;
    requestVersion.current++;
    setNotes((current) =>
      current.some((note) => note.id === saved.id)
        ? current.map((note) => (note.id === saved.id ? saved : note))
        : [saved, ...current],
    );
    setSaveError("");
    const appears =
      getVisibleNotes([saved], showPrivate, activeTags, query, dateFilter)
        .length > 0;
    setStatus(
      saved.isPrivate && !showPrivate
        ? "Saved. Your private thought is hidden."
        : appears
          ? "Saved to your account."
          : "Saved. This thought is outside the current filters.",
    );
  }

  async function deleteNote(id: string): Promise<boolean> {
    if (!window.confirm("Delete this note? This cannot be undone."))
      return false;
    const note = notes.find((note) => note.id === id);
    if (!note) throw new Error("Note not found. Refresh your board.");
    await deleteCloudNote(note, userId);
    if (alive.current) {
      requestVersion.current++;
      setNotes((current) => current.filter((note) => note.id !== id));
      setStatus("Thought deleted.");
      setSaveError("");
    }
    return true;
  }

  function toggleTag(tag: string) {
    setSelectedTags(
      activeTags.includes(tag)
        ? activeTags.filter((item) => item !== tag)
        : [...activeTags, tag],
    );
    setStatus("");
  }

  function togglePrivate() {
    if (showPrivate) {
      setShowPrivate(false);
      const publicTags = new Set(
        notes.filter((note) => !note.isPrivate).flatMap((note) => note.tags),
      );
      setSelectedTags(activeTags.filter((tag) => publicTags.has(tag)));
    } else if (
      window.confirm("Are you sure you want to display private notes?")
    )
      setShowPrivate(true);
    setStatus("");
  }

  function clearFilters() {
    setQuery("");
    setSelectedTags([]);
    setDateFilter("");
    setStatus("");
  }

  return (
    <>
      <header className="app-header">
        <div className="brand">
          Thoughtboard<span className="brand-dot">.</span>
        </div>
        <span className="header-description">
          A place for everything on your mind.
        </span>
        <div className="account-actions">
          <button
            className="small-button"
            disabled={loading || importing || organizing}
            onClick={() => void refresh()}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            className="small-button"
            disabled={importing || organizing}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
        <button
          className={`privacy-button${showPrivate ? " revealed" : ""}`}
          aria-pressed={showPrivate}
          onClick={togglePrivate}
        >
          <Icon name={showPrivate ? "unlock" : "lock"} size={13} />
          <span>
            {showPrivate ? "Hide private notes" : "Show private notes"}
          </span>
        </button>
      </header>
      <main className="app">
        <section className="board-controls" aria-label="Board controls">
          <div className="search-row">
            <div className="search-field">
              <Icon name="search" size={17} />
              <input
                ref={searchInput}
                aria-label="Search notes"
                type="search"
                placeholder="Search by text, tag, or date…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setStatus("");
                }}
              />
              {query ? (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <Icon name="close" size={14} />
                </button>
              ) : (
                <kbd>⌘ / Ctrl K</kbd>
              )}
            </div>
            <button
              className="add-button"
              aria-label="Add note"
              title="Add a thought"
              onClick={addNote}
              disabled={!ready || loading || importing || organizing}
            >
              <Icon name="plus" size={21} />
            </button>
          </div>
          <div className="filter-row">
            <div
              className="tag-filters"
              role="group"
              aria-label="Filter notes by tag"
            >
              <button
                className={`tag-button all-tag${activeTags.length === 0 ? " selected" : ""}`}
                aria-pressed={activeTags.length === 0}
                onClick={() => setSelectedTags([])}
              >
                All thoughts
              </button>
              {availableTags.map((tag) => (
                <button
                  className={`tag-button${activeTags.includes(tag) ? " selected" : ""}`}
                  style={tagStyle(tag)}
                  key={tag}
                  aria-pressed={activeTags.includes(tag)}
                  onClick={() => toggleTag(tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
            <label className={`date-filter${dateFilter ? " active" : ""}`}>
              <Icon name="calendar" size={13} />
              <span className="sr-only">Filter by note date</span>
              <input
                type="date"
                aria-label="Filter by note date"
                value={dateFilter}
                onChange={(event) => {
                  setDateFilter(event.target.value);
                  setStatus("");
                }}
              />
            </label>
          </div>
          <div className="organize-row">
            <label className="sort-control">
              Sort
              <select
                aria-label="Sort notes"
                value={layout.sort}
                disabled={!layoutReady || loading || importing || organizing}
                onChange={(event) =>
                  void organize({
                    ...layout,
                    sort: event.target.value as SortMode,
                  })
                }
              >
                {SORT_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <span className="organize-hint">
              {organizing
                ? "Saving order…"
                : "Drag ⠿ to arrange · dragging switches to manual order"}
            </span>
          </div>
          <div className="results-row">
            <span role="status">
              {visibleNotes.length}{" "}
              {visibleNotes.length === 1 ? "thought" : "thoughts"}
              {hasFilters ? " found" : ""}
              {activeTags.length > 1 ? " · any selected tag" : ""}
            </span>
            <span className="save-status" role="status">
              {status}
            </span>
            {hasFilters ? (
              <button className="text-button" onClick={clearFilters}>
                Clear filters
              </button>
            ) : (
              <span className="local-status">
                <span />
                {!ready
                  ? "Connecting…"
                  : loading
                    ? "Refreshing…"
                    : "Saved to your account"}
              </span>
            )}
          </div>
        </section>
        {layoutError && (
          <p className="error" role="alert">
            {layoutError}
          </p>
        )}
        {saveError && (
          <p className="error" role="alert">
            {saveError}
          </p>
        )}
        {initial.error && (
          <p className="error">Local import unavailable: {initial.error}</p>
        )}
        {ready && initial.notes.length > 0 && !importComplete && (
          <section className="import-banner" aria-label="Import local notes">
            <div>
              <strong>Bring your existing thoughts with you.</strong>
              <p>
                Import this browser’s notes and images into your account. Your
                local copies will stay here.
              </p>
            </div>
            <button
              className="primary-button"
              disabled={importing || loading}
              onClick={() => void runImport()}
            >
              {importing ? "Importing…" : "Import local notes"}
            </button>
          </section>
        )}
        {!ready ? (
          <div className="empty-state">
            <h1>
              {loading
                ? "Opening your board…"
                : "Your board couldn’t be loaded."}
            </h1>
            {!loading && (
              <button className="primary-button" onClick={() => void refresh()}>
                Try again
              </button>
            )}
          </div>
        ) : visibleNotes.length ? (
          <MasonryBoard
            notes={visibleNotes}
            disabled={!layoutReady || loading || importing || organizing}
            onEdit={(selected) => {
              if (!loading && !importing && !organizing)
                setEditor({ note: selected, isNew: false });
            }}
            onTag={toggleTag}
            onOrder={(ids) =>
              void organize({
                ...layout,
                sort: "manual",
                order: mergeVisibleOrder(
                  orderedNotes.map((note) => note.id),
                  ids,
                ),
              })
            }
          />
        ) : (
          <div className="empty-state">
            <span className="empty-symbol">✳</span>
            <h1>
              {hasFilters
                ? "Nothing here just yet."
                : "Make room for a thought."}
            </h1>
            <p>
              {hasFilters
                ? "Try a different search, tag, or date."
                : "A passing idea, a link to revisit, a plan for tomorrow."}
            </p>
            <button
              className="primary-button"
              onClick={hasFilters ? clearFilters : addNote}
              disabled={loading || importing || organizing}
            >
              {hasFilters ? "Clear filters" : "Add your first thought"}
            </button>
          </div>
        )}
      </main>
      {editor && (
        <NoteEditor
          key={editor.note.id}
          note={editor.note}
          isNew={editor.isNew}
          availableTags={availableTags}
          onSave={saveNote}
          onDelete={deleteNote}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
