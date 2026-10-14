import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import MarkdownContent from "./MarkdownContent";
import Icon from "./Icons";
import { saveImage } from "./images";
import { isValidDay, normalizeTags } from "./notes";
import type { Note } from "./notes";
import { errorMessage } from "./supabase";

type Props = {
  note: Note;
  isNew: boolean;
  onSave: (note: Note) => Promise<void>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
};

export default function NoteEditor({
  note,
  isNew,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tagText, setTagText] = useState(note.tags.join(", "));
  const [isPrivate, setIsPrivate] = useState(note.isPrivate);
  const [noteDate, setNoteDate] = useState(note.noteDate ?? "");
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const dirty =
    title !== note.title ||
    content !== note.content ||
    tagText !== note.tags.join(", ") ||
    isPrivate !== note.isPrivate ||
    noteDate !== (note.noteDate ?? "");

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    textarea.current?.focus();
    return () => {
      element?.close();
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function close() {
    if (uploading || savingRef.current) return;
    if (!dirty || window.confirm("Discard your unsaved changes?")) onClose();
  }

  async function save() {
    if (uploading || savingRef.current) return;
    if (noteDate && !isValidDay(noteDate)) {
      setError("Choose a valid date.");
      return;
    }
    const tags = normalizeTags(tagText.split(","));
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave({
        ...note,
        title,
        content,
        tags: tags.filter((tag) => tag !== "private"),
        isPrivate: isPrivate || tags.includes("private"),
        noteDate: noteDate || null,
      });
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function remove() {
    if (uploading || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      if (await onDelete(note.id)) onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function insert(text: string) {
    const field = textarea.current;
    const start = field?.selectionStart ?? content.length;
    const end = field?.selectionEnd ?? content.length;
    setContent(
      (current) => current.slice(0, start) + text + current.slice(end),
    );
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  function formatSelection(marker: string) {
    const field = textarea.current;
    const selection = content.slice(
      field?.selectionStart ?? 0,
      field?.selectionEnd ?? 0,
    );
    insert(`${marker}${selection || "text"}${marker}`);
  }

  function insertUrl(image: boolean) {
    const input = window.prompt(
      image ? "Image URL (https://…)" : "Link URL (https://…)",
    );
    if (input === null) return;
    let url: URL;
    try {
      url = new URL(input.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      setError("Enter a complete http:// or https:// URL.");
      return;
    }
    const label = window.prompt(
      image ? "Image description" : "Link text",
      image ? "Image" : "Open link",
    );
    if (label === null) return;
    const safe = (label.trim() || (image ? "Image" : "Open link")).replace(
      /[\\\[\]\n\r]/g,
      " ",
    );
    setError("");
    insert(`${image ? "!" : ""}[${safe}](<${url.href}>)`);
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const source = await saveImage(file);
      const label = file.name.replace(/[\\\[\]\n\r]/g, " ");
      setContent(
        (current) => `${current}${current ? "\n\n" : ""}![${label}](${source})`,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The image could not be saved.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="note-dialog"
      aria-labelledby="editor-heading"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          save();
        }
      }}
    >
      <header className="editor-header">
        <h2 id="editor-heading">{isNew ? "A new thought" : "Edit thought"}</h2>
        <button
          className="icon-button"
          aria-label="Close editor"
          disabled={uploading || saving}
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      <fieldset className="editor-body" disabled={saving}>
        <input
          className="note-title"
          aria-label="Note title"
          placeholder="Title (optional)"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className="editor-toolbar" aria-label="Formatting">
          <div className="editor-tabs">
            <button aria-pressed={!preview} onClick={() => setPreview(false)}>
              Write
            </button>
            <button aria-pressed={preview} onClick={() => setPreview(true)}>
              Preview
            </button>
          </div>
          {!preview && (
            <div className="format-buttons">
              <button
                className="small-button"
                aria-label="Bold"
                onClick={() => formatSelection("**")}
              >
                <strong>B</strong>
              </button>
              <button
                className="small-button"
                aria-label="Italic"
                onClick={() => formatSelection("*")}
              >
                <em>I</em>
              </button>
              <button className="small-button" onClick={() => insertUrl(false)}>
                Link
              </button>
              <button className="small-button" onClick={() => insertUrl(true)}>
                Image URL
              </button>
              <button
                className="small-button"
                disabled={uploading || saving}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label="Upload image file"
            hidden
            onChange={upload}
          />
        </div>
        {preview ? (
          <div className="editor-preview">
            <MarkdownContent content={content} />
          </div>
        ) : (
          <textarea
            ref={textarea}
            className="note-content"
            aria-label="Note content"
            placeholder="What's on your mind?"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        )}
        <p className="editor-hint">
          Markdown supported. *Italic*, **bold**, links, lists, and images.
        </p>
        <div className="editor-fields">
          <label className="field-label">
            Tags
            <input
              className="field-input"
              placeholder="work, ideas, guitar"
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
            />
          </label>
          <label className="field-label">
            Note date (optional)
            <input
              className="field-input"
              type="date"
              ref={dateInput}
              value={noteDate}
              onChange={(event) => setNoteDate(event.target.value)}
            />
          </label>
        </div>
        <div className="editor-options">
          <label className="private-checkbox">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(event) => setIsPrivate(event.target.checked)}
            />
            <Icon name="lock" size={13} /> Private note
          </label>
          {noteDate && (
            <button
              className="text-button"
              onClick={() => {
                setNoteDate("");
                dateInput.current?.focus();
              }}
            >
              Remove date
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
      <footer className="editor-footer">
        {!isNew && (
          <button
            className="delete-button"
            disabled={uploading || saving}
            onClick={() => void remove()}
          >
            <Icon name="trash" size={14} />
            Delete
          </button>
        )}
        <span className="save-hint">Ctrl / ⌘ + Enter to save</span>
        <button
          className="small-button"
          disabled={uploading || saving}
          onClick={close}
        >
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={uploading || saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save thought"}
        </button>
      </footer>
    </dialog>
  );
}
