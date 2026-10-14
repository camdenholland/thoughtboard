import type { CSSProperties } from "react";
import MarkdownContent from "./MarkdownContent";
import Icon from "./Icons";
import { formatCreatedAt, formatNoteDate } from "./notes";
import type { Note } from "./notes";
import { tagColor, tagStyle } from "./tagColors";

type Props = {
  note: Note;
  onEdit: (note: Note) => void;
  onTag: (tag: string) => void;
};

export default function NoteCard({ note, onEdit, onTag }: Props) {
  const style = {
    "--card-accent": note.tags[0] ? `${tagColor(note.tags[0])}88` : "#343638",
  } as CSSProperties;
  return (
    <article className="note" style={style}>
      <header className="note-meta">
        {note.createdAt ? (
          <time
            dateTime={note.createdAt}
            title={new Date(note.createdAt).toLocaleString()}
          >
            {formatCreatedAt(note.createdAt)}
          </time>
        ) : (
          <span>Earlier note</span>
        )}
        <button
          className="icon-button edit-note"
          aria-label={`Edit ${note.title || "note"}`}
          title="Edit note"
          onClick={() => onEdit(note)}
        >
          <Icon name="edit" size={13} />
        </button>
      </header>
      {(note.isPrivate || note.tags.length > 0) && (
        <div className="note-tags">
          {note.isPrivate && (
            <span className="tag private-badge">
              <Icon name="lock" size={10} />
              private
            </span>
          )}
          {note.tags.map((tag) => (
            <button
              className="tag"
              style={tagStyle(tag)}
              key={tag}
              onClick={() => onTag(tag)}
              aria-label={`Filter by ${tag}`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
      {note.title && <h2 className="note-heading">{note.title}</h2>}
      <MarkdownContent content={note.content} />
      {note.noteDate && (
        <footer className="note-date">
          <Icon name="calendar" size={12} />
          <time dateTime={note.noteDate}>{formatNoteDate(note.noteDate)}</time>
        </footer>
      )}
    </article>
  );
}
