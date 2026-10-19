import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import MarkdownContent, { NoteImage } from "./MarkdownContent";
import {
  EditorContent,
  useEditor,
  useEditorState,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Icon from "./Icons";
import { checklistState, sortChecklistMarkdown, sortEditorChecklists } from "./checklists";
import { saveImage } from "./images";
import { isValidDay, normalizeTags } from "./notes";
import type { Note } from "./notes";
import { errorMessage } from "./supabase";

function EditorImage({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper as="div" className="editor-image" contentEditable={false}>
      <NoteImage src={node.attrs.src} alt={node.attrs.alt} />
    </NodeViewWrapper>
  );
}
const SafeImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EditorImage);
  },
});
const needsSource = (text: string) =>
  /(^ {0,3}\[\^|<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>]*|\/?)>)/m.test(text);

type Props = {
  note: Note;
  isNew: boolean;
  availableTags: string[];
  onSave: (note: Note) => Promise<void>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
};

export default function NoteEditor({
  note,
  isNew,
  availableTags,
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
  const [mode, setMode] = useState<"write" | "markdown" | "preview">(
    needsSource(note.content) ? "markdown" : "write",
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const sortingChecklist = useRef(false);
  const rich = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false } }),
      SafeImage,
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true, HTMLAttributes: { "data-type": "taskItem" } }),
      Markdown,
    ],
    content: note.content,
    contentType: "markdown",
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Note content",
        "aria-multiline": "true",
        class: "rich-content markdown-content",
      },
    },
    onUpdate: ({ editor, transaction }) => {
      const before = checklistState(transaction.before);
      const after = checklistState(editor.state.doc);
      if (!sortingChecklist.current && before.count === after.count && before.checked !== after.checked) {
        sortingChecklist.current = true;
        try { sortEditorChecklists(editor); } finally { sortingChecklist.current = false; }
      }
      setContent(editor.getMarkdown());
    },
    onBlur: ({ editor, event }) => {
      if (event.relatedTarget instanceof Node && editor.view.dom.contains(event.relatedTarget)) return;
      if (!editor.isDestroyed && editor.isEditable) sortEditorChecklists(editor);
    },
  });
  const formatting = useEditorState({
    editor: rich,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      strike: editor?.isActive("strike") ?? false,
      checklist: editor?.isActive("taskList") ?? false,
    }),
  });
  useEffect(() => {
    rich?.setEditable(!saving && !uploading, false);
  }, [rich, saving, uploading]);
  const chosenTags = normalizeTags(tagText.split(","));
  const suggestedTags = [...new Set([...availableTags, ...note.tags])]
    .filter((tag) => tag !== "private")
    .sort();
  function toggleExistingTag(tag: string) {
    setTagText(
      (chosenTags.includes(tag)
        ? chosenTags.filter((item) => item !== tag)
        : [...chosenTags, tag]
      ).join(", "),
    );
  }
  function changeMode(next: "write" | "markdown" | "preview") {
    if (mode === "write" && rich) {
      sortEditorChecklists(rich);
      if (next !== "write") setContent(rich.getMarkdown());
    }
    if (next === "write") {
      if (needsSource(content)) {
        setError(
          "Use Markdown mode to preserve HTML or footnote markup in this note.",
        );
        return;
      }
      rich?.commands.setContent(content, {
        contentType: "markdown",
        emitUpdate: false,
      });
    }
    setMode(next);
    setError("");
  }
  const dirty =
    title !== note.title ||
    content !== note.content ||
    tagText !== note.tags.join(", ") ||
    isPrivate !== note.isPrivate ||
    noteDate !== (note.noteDate ?? "");

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    if (mode === "markdown") textarea.current?.focus();
    else rich?.commands.focus("end");
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
        content: sortChecklistMarkdown(mode === "write" && rich ? rich.getMarkdown() : content),
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
    if (mode === "write") {
      if (image)
        rich?.chain().focus().setImage({ src: url.href, alt: safe }).run();
      else
        rich
          ?.chain()
          .focus()
          .insertContent({
            type: "text",
            text: safe,
            marks: [{ type: "link", attrs: { href: url.href } }],
          })
          .run();
    } else insert(`${image ? "!" : ""}[${safe}](<${url.href}>)`);
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
      if (mode === "write")
        rich?.chain().focus().setImage({ src: source, alt: label }).run();
      else
        setContent(
          (current) =>
            `${current}${current ? "\n\n" : ""}![${label}](${source})`,
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
            <button
              disabled={uploading}
              aria-pressed={mode === "write"}
              onClick={() => changeMode("write")}
            >
              Write
            </button>
            <button
              disabled={uploading}
              aria-pressed={mode === "markdown"}
              onClick={() => changeMode("markdown")}
            >
              Markdown
            </button>
            <button
              disabled={uploading}
              aria-pressed={mode === "preview"}
              onClick={() => changeMode("preview")}
            >
              Preview
            </button>
          </div>
          {mode !== "preview" && (
            <div className="format-buttons">
              {mode === "write" && (
                <>
                  <button
                    className="small-button"
                    aria-label="Checklist"
                    aria-pressed={formatting?.checklist ?? false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => rich?.chain().focus().toggleTaskList().run()}
                  >
                    Checklist
                  </button>
                  <button
                    className="small-button"
                    aria-label="Bold"
                    aria-pressed={formatting?.bold ?? false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => rich?.chain().focus().toggleBold().run()}
                  >
                    <strong>B</strong>
                  </button>
                  <button
                    className="small-button"
                    aria-label="Italic"
                    aria-pressed={formatting?.italic ?? false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => rich?.chain().focus().toggleItalic().run()}
                  >
                    <em>I</em>
                  </button>
                  <button
                    className="small-button"
                    aria-label="Strikethrough"
                    aria-pressed={formatting?.strike ?? false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => rich?.chain().focus().toggleStrike().run()}
                  >
                    <s>S</s>
                  </button>
                </>
              )}
              <button
                className="small-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertUrl(false)}
              >
                Link
              </button>
              <button
                className="small-button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertUrl(true)}
              >
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
        <div hidden={mode !== "write"}>
          <EditorContent editor={rich} />
        </div>
        {mode === "preview" && (
          <div className="editor-preview">
            <MarkdownContent content={content} />
          </div>
        )}
        {mode === "markdown" && (
          <textarea
            ref={textarea}
            className="note-content"
            aria-label="Markdown source"
            placeholder="What's on your mind?"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        )}
        <p className="editor-hint">
          {mode === "write"
            ? "Toggle B, I, or S, then type. Toggle again to stop. Ctrl+B or Ctrl+I also works."
            : "Edit Markdown directly, or switch to Write for visual formatting."}
        </p>
        <p className="checklist-hint">Checklists: unchecked first, then A–Z. Text sorts when you leave the editor or save.</p>
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
        {suggestedTags.length > 0 && (
          <div className="tag-picker">
            <span className="tag-picker-label">Choose existing tags</span>
            <div
              className="tag-options"
              role="group"
              aria-label="Existing tags"
            >
              {suggestedTags.map((tag) => (
                <button
                  key={tag}
                  className="small-button"
                  aria-pressed={chosenTags.includes(tag)}
                  onClick={() => toggleExistingTag(tag)}
                >
                  #{tag}
                </button>
              ))}
            </div>
          </div>
        )}
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
        <span className="save-hint">Ctrl+Enter to save</span>
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
