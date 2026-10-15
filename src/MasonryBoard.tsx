import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import type { CSSProperties } from "react";
import type { Note } from "./notes";
import NoteCard from "./NoteCard";
import { shortestColumns } from "./boardLayout";

type Props = {
  notes: Note[];
  disabled: boolean;
  onEdit: (note: Note) => void;
  onTag: (tag: string) => void;
  onOrder: (ids: string[]) => void;
};
function Tile({
  note,
  style,
  disabled,
  onEdit,
  onTag,
}: { note: Note; style: CSSProperties } & Pick<
  Props,
  "disabled" | "onEdit" | "onTag"
>) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    isDragging,
    isOver,
  } = useSortable({ id: note.id, disabled, strategy: () => null });
  return (
    <div
      ref={setNodeRef}
      className={`board-tile${isDragging ? " dragging" : ""}${isOver ? " drop-target" : ""}`}
      data-note-id={note.id}
      style={style}
    >
      <NoteCard
        note={note}
        onEdit={onEdit}
        onTag={onTag}
        dragHandle={
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className="icon-button drag-handle"
            disabled={disabled}
            aria-label={`Move ${note.title || "note"}`}
            title="Drag to reorder · Space then arrow keys with keyboard"
          >
            ⠿
          </button>
        }
      />
    </div>
  );
}
export default function MasonryBoard({
  notes,
  disabled,
  onEdit,
  onTag,
  onOrder,
}: Props) {
  const container = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(0);
  const [layout, setLayout] = useState<{
    positions: { column: number; top: number }[];
    height: number;
  }>({ positions: [], height: 0 });
  const [active, setActive] = useState<string | null>(null);
  const columns = Math.max(1, Math.floor((width + 16) / 336));
  const cardWidth = width ? (width - (columns - 1) * 16) / columns : undefined;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    setWidth(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const heights = Array.from(element.children).map(
        (child) => child.getBoundingClientRect().height,
      );
      const next = shortestColumns(heights, columns);
      setLayout((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      );
    };
    measure();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    Array.from(element.children).forEach((child) => observer.observe(child));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [notes, columns, cardWidth]);
  const dragged = notes.find((note) => note.id === active);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setActive(String(event.active.id))}
      onDragCancel={() => setActive(null)}
      onDragEnd={({ active: from, over }) => {
        setActive(null);
        if (!over || disabled || from.id === over.id) return;
        const a = notes.findIndex((note) => note.id === from.id),
          b = notes.findIndex((note) => note.id === over.id);
        if (a >= 0 && b >= 0)
          onOrder(
            arrayMove(
              notes.map((note) => note.id),
              a,
              b,
            ),
          );
      }}
    >
      <SortableContext
        items={notes.map((note) => note.id)}
        strategy={() => null}
      >
        <section
          ref={container}
          className="board"
          aria-label="Notes"
          style={{ height: layout.height }}
        >
          {notes.map((note, index) => {
            const point = layout.positions[index];
            return (
              <Tile
                key={note.id}
                note={note}
                disabled={disabled}
                onEdit={onEdit}
                onTag={onTag}
                style={{
                  position: "absolute",
                  width: cardWidth ?? "100%",
                  left: (point?.column ?? 0) * ((cardWidth ?? 0) + 16),
                  top: point?.top ?? 0,
                  visibility: width ? "visible" : "hidden",
                }}
              />
            );
          })}
        </section>
      </SortableContext>
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {dragged && (
            <div className="drag-preview" style={{ width: cardWidth }}>
              <NoteCard note={dragged} onEdit={() => {}} onTag={() => {}} />
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}
