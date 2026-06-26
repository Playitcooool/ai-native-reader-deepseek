import type { TocNode } from "../toc/TocSidebar";

const SECTION_INTENT_RE = /\b(section|chapter|current section|current chapter|this section|this chapter)\b|本章|本节|章节|小节/i;

export type AskScope =
  | { kind: "page" }
  | { kind: "section"; node: TocNode; startPage: number; endPage: number };

export function inferAskScope(question: string, currentPage: number, tocNodes: TocNode[]): AskScope {
  if (!SECTION_INTENT_RE.test(question)) return { kind: "page" };
  const node = activeTocNode(currentPage, tocNodes);
  return node
    ? { kind: "section", node, startPage: node.start_page, endPage: node.end_page ?? node.start_page }
    : { kind: "page" };
}

function activeTocNode(page: number, tocNodes: TocNode[]): TocNode | null {
  return tocNodes
    .filter((node) => node.start_page <= page && (node.end_page == null || node.end_page >= page))
    .sort((a, b) => b.level - a.level || b.start_page - a.start_page)[0] ?? null;
}
