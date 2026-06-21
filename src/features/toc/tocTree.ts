import { PDFDocumentProxy } from "pdfjs-dist";

export interface TocNodeInput {
  parent_id: string | null;
  title: string;
  level: number;
  order_index: number;
  start_page: number;
  end_page: number | null;
  temp_id?: string;
}

interface OutlineItem {
  title: string;
  dest?: unknown;
  items?: OutlineItem[];
}

// Resolve outline item to a page number
async function resolvePage(
  pdf: PDFDocumentProxy,
  item: OutlineItem,
): Promise<number | null> {
  if (!item.dest) return null;
  let dest = null;
  if (typeof item.dest === "string") {
    dest = await pdf.getDestination(item.dest);
  } else if (Array.isArray(item.dest)) {
    dest = item.dest;
  }
  if (!dest || !dest[0]) return null;
  try {
    const pageIndex = await pdf.getPageIndex(dest[0]);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

// Flatten outline tree into ordered list with computed end pages
async function flattenOutline(
  pdf: PDFDocumentProxy,
  items: OutlineItem[],
  parentId: string | null = null,
  level: number = 0,
  orderCounter: { value: number } = { value: 0 },
): Promise<TocNodeInput[]> {
  const nodes: TocNodeInput[] = [];

  for (const item of items) {
    const page = await resolvePage(pdf, item);
    const hasChildren = item.items && item.items.length > 0;

    // Skip leaf nodes with no resolvable page
    if (page === null && !hasChildren) continue;

    // Container node with no resolvable page: promote children to parent level, skip self
    if (page === null && hasChildren && item.items) {
      const children = await flattenOutline(pdf, item.items, parentId, level, orderCounter);
      nodes.push(...children);
      continue;
    }

    orderCounter.value++;
    const nodeId = `toc_${orderCounter.value}`;
    nodes.push({
      temp_id: nodeId,
      parent_id: parentId,
      title: item.title,
      level,
      order_index: orderCounter.value,
      start_page: page ?? 1,
      end_page: null,
    });

    if (hasChildren && item.items) {
      const children = await flattenOutline(pdf, item.items, nodeId, level + 1, orderCounter);
      nodes.push(...children);
    }
  }

  return nodes;
}

// Compute end pages based on the next node of same or higher level.
// Nodes MUST be in DFS order (parent before children, siblings sequential).
export function computeEndPages(
  nodes: TocNodeInput[],
  totalPages: number,
): TocNodeInput[] {
  const result = nodes.map((n) => ({ ...n }));

  for (let i = 0; i < result.length; i++) {
    const node = result[i];
    // Find next node at same or higher level (level numerically <= node.level).
    // In DFS order this finds the next sibling or the parent's next sibling.
    let nextIdx = -1;
    for (let j = i + 1; j < result.length; j++) {
      if (result[j].level <= node.level) {
        nextIdx = j;
        break;
      }
    }
    node.end_page = nextIdx >= 0 ? result[nextIdx].start_page - 1 : totalPages;
  }

  return result;
}

// Extract, flatten, compute end pages, and return TOC nodes
export async function extractToc(
  pdf: PDFDocumentProxy,
  totalPages: number,
): Promise<TocNodeInput[]> {
  const outline = await pdf.getOutline();
  if (!outline || outline.length === 0) return [];

  const flat = await flattenOutline(pdf, outline as OutlineItem[]);
  if (flat.length === 0) return [];

  return computeEndPages(flat, totalPages);
}
