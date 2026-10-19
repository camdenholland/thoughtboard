import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Editor } from "@tiptap/react";
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

const alphabet = new Intl.Collator("en", { sensitivity: "base", numeric: true });
const compare = (a: { checked: boolean; text: string }, b: { checked: boolean; text: string }) =>
  Number(a.checked) - Number(b.checked) || alphabet.compare(a.text.trim(), b.text.trim());

type AstNode = {
  type: string;
  value?: string;
  alt?: string;
  checked?: boolean | null;
  children?: AstNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};
const parser = unified().use(remarkParse).use(remarkGfm);
const plain = (node: AstNode): string => node.value ?? node.alt ?? node.children?.map(plain).join("") ?? "";

// Reorder complete source slices, preserving fences, HTML, links, and nested lists.
export function sortChecklistMarkdown(source: string): string {
  const root = parser.parse(source) as AstNode;
  function render(node: AstNode): string {
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? source.length;
    if (!node.children?.length) return source.slice(start, end);
    const children = node.children;
    const pieces = children.map(render);
    if (node.type === "list") {
      for (let i = 0; i < children.length;) {
        if (typeof children[i].checked !== "boolean") { i++; continue; }
        let last = i + 1;
        while (last < children.length && typeof children[last].checked === "boolean") last++;
        const sorted = children.slice(i, last).map((child, n) => ({
          checked: child.checked === true,
          text: plain(child.children?.find(c => c.type === "paragraph") ?? child),
          source: pieces[i + n],
        })).sort(compare);
        sorted.forEach((item, n) => { pieces[i + n] = item.source; });
        i = last;
      }
    }
    let result = "", cursor = start;
    children.forEach((child, i) => {
      const a = child.position?.start.offset, b = child.position?.end.offset;
      if (a === undefined || b === undefined) return;
      result += source.slice(cursor, a) + pieces[i];
      cursor = b;
    });
    return result + source.slice(cursor, end);
  }
  return render(root);
}

export function checklistState(doc: PMNode) {
  let count = 0, checked = 0;
  doc.descendants(node => {
    if (node.type.name === "taskItem") { count++; if (node.attrs.checked) checked++; }
  });
  return { count, checked };
}

// Keep the caret attached to its item, even when that item moves.
export function sortEditorChecklists(editor: Editor) {
  const tr = editor.state.tr;
  const lists: number[] = [];
  tr.doc.descendants((node, pos) => { if (node.type.name === "taskList") lists.push(pos); });
  for (const pos of lists.reverse()) {
    const list = tr.doc.nodeAt(pos);
    if (!list) continue;
    const items: { node: PMNode; start: number; checked: boolean; text: string }[] = [];
    list.forEach((node, offset) => items.push({ node, start: pos + 1 + offset,
      checked: node.attrs.checked === true, text: node.firstChild?.textContent ?? "" }));
    const sorted = [...items].sort(compare);
    if (sorted.every((item, i) => item === items[i])) continue;
    const move = (selection: number) => {
      let next = pos + 1;
      for (const item of sorted) {
        if (selection >= item.start && selection < item.start + item.node.nodeSize)
          return next + selection - item.start;
        next += item.node.nodeSize;
      }
      return selection;
    };
    const selection = tr.selection;
    const anchor = move(selection.anchor), head = move(selection.head);
    tr.replaceWith(pos + 1, pos + list.nodeSize - 1, Fragment.fromArray(sorted.map(item => item.node)));
    if (selection instanceof TextSelection) tr.setSelection(TextSelection.create(tr.doc, anchor, head));
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}
