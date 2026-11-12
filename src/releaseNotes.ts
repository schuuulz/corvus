// Reads the release notes the updater manifest carries: the GitHub Release
// body release-please writes, in Markdown. Only headings and list items are
// kept, as plain text, so nothing from the manifest is ever rendered as markup.

export interface NoteSection {
  /** "Features", "Bug Fixes", … ("" for items before any heading). */
  title: string;
  items: string[];
}

const MAX_ITEMS = 40;
const MAX_ITEM_LENGTH = 240;
const MAX_LINE_LENGTH = 1000;

/** "([#34](https://…))" and "([abc1234](https://…))" after an entry. */
const TRAILING_REFERENCE = /\s*\(\[[^\]]*\]\([^)]*\)\)\s*$/;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const BOLD = /\*\*([^*]*)\*\*/g;

/** "**graph:** one-click switch ([#34](…)) ([abc1234](…))" → "graph: one-click switch". */
function plainItem(markdown: string): string {
  let text = markdown;
  while (TRAILING_REFERENCE.test(text)) text = text.replace(TRAILING_REFERENCE, "");
  text = text.replace(LINK, "$1").replace(BOLD, "$1").trim();
  return text.length > MAX_ITEM_LENGTH ? `${text.slice(0, MAX_ITEM_LENGTH - 1)}…` : text;
}

export function parseReleaseNotes(markdown: string): NoteSection[] {
  const sections: NoteSection[] = [];
  let itemCount = 0;
  for (const raw of markdown.split(/\r?\n/)) {
    // A generous bound keeps the patterns below linear on any manifest.
    const line = raw.trim().slice(0, MAX_LINE_LENGTH);
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      sections.push({ title: plainItem(heading[1]), items: [] });
      continue;
    }
    const item = line.match(/^[*-]\s+(.+)$/);
    if (!item || itemCount >= MAX_ITEMS) continue;
    const text = plainItem(item[1]);
    if (!text) continue;
    if (!sections.length) sections.push({ title: "", items: [] });
    sections[sections.length - 1].items.push(text);
    itemCount++;
  }
  return sections.filter((s) => s.items.length);
}
