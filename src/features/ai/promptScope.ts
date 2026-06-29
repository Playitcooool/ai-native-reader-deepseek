import type { TocNode } from "../toc/TocSidebar";

const SECTION_INTENT_RE = /\b(section|chapter|current section|current chapter|this section|this chapter)\b|本章|本节|章节|小节/i;
const WHOLE_DOCUMENT_RE = /\b(whole|entire|full|all)\s+(paper|document|pdf|book|ebook|file)|全文|整篇|整本|整份/i;

export type AskScope =
  | { kind: "page" }
  | { kind: "pages"; pages: number[] }
  | { kind: "range"; startPage: number; endPage: number }
  | { kind: "section"; node: TocNode; startPage: number; endPage: number };

export function inferAskScope(question: string, currentPage: number, tocNodes: TocNode[], pageCount = 0): AskScope {
  const explicitPages = parseExplicitPages(question);
  if (explicitPages) return explicitPages;
  const explicitRange = parseExplicitPageRange(question);
  if (explicitRange) return explicitRange;
  if (WHOLE_DOCUMENT_RE.test(question)) {
    const endPage = pageCount || tocNodes.reduce((max, node) => Math.max(max, node.end_page ?? node.start_page), 0);
    if (endPage > 0) return { kind: "range", startPage: 1, endPage };
  }
  if (!SECTION_INTENT_RE.test(question)) return { kind: "page" };
  const node = activeTocNode(currentPage, tocNodes);
  return node
    ? { kind: "section", node, startPage: node.start_page, endPage: node.end_page ?? node.start_page }
    : { kind: "page" };
}

function parseExplicitPages(question: string): AskScope | null {
  const match = question.match(/\b(?:pages?|p\.)\s+(\d{1,5}(?:(?:\s*(?:,|，)\s*(?:and\s*)?|\s*(?:and|&)\s*)\d{1,5})+)/i);
  if (!match) return null;
  const pages = Array.from(new Set((match[1].match(/\d{1,5}/g) ?? []).map(Number))).sort((a, b) => a - b);
  return pages.length > 1 ? { kind: "pages", pages } : null;
}

function parseExplicitPageRange(question: string): AskScope | null {
  const match = question.match(/\b(?:pages?|p\.)\s*(\d{1,5})(?:\s*(?:-|–|—|to|through|and)\s*(\d{1,5}))?\b/i);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2] ?? match[1]);
  return { kind: "range", startPage: Math.min(a, b), endPage: Math.max(a, b) };
}

function activeTocNode(page: number, tocNodes: TocNode[]): TocNode | null {
  return tocNodes
    .filter((node) => node.start_page <= page && (node.end_page == null || node.end_page >= page))
    .sort((a, b) => b.level - a.level || b.start_page - a.start_page)[0] ?? null;
}
