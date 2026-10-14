import type { CSSProperties } from "react";
const palette = [
  "#64b991",
  "#d49a66",
  "#ad9bdb",
  "#7caed1",
  "#cc8f9d",
  "#b4b77b",
];
const common: Record<string, number> = {
  ideas: 0,
  work: 1,
  guitar: 2,
  study: 3,
  personal: 4,
  home: 5,
};
export function tagColor(tag: string): string {
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[common[tag] ?? hash % palette.length];
}
export function tagStyle(tag: string): CSSProperties {
  const color = tagColor(tag);
  return { "--tag-color": color, "--tag-bg": `${color}1a` } as CSSProperties;
}
