export function pagesNeededForWorkflow(input: {
  mode: string;
  pageNumber: number;
  startPage?: number;
  endPage?: number;
  pageNumbers?: number[];
  pageCount?: number | null;
}): number[] {
  if (input.mode === "pages_qa" && input.pageNumbers?.length) {
    const pages = Array.from(new Set(input.pageNumbers.filter((page) => page >= 1))).sort((a, b) => a - b);
    return pages.length <= 12 ? pages : pages.filter((_, i) => i === 0 || i === pages.length - 1 || i % Math.ceil(pages.length / 10) === 0);
  }
  if ((input.mode !== "range_summary" && input.mode !== "chapter_qa" && input.mode !== "range_qa") || !input.startPage || !input.endPage) {
    return [input.pageNumber];
  }
  const start = Math.min(input.startPage, input.endPage);
  const end = Math.max(input.startPage, input.endPage);
  const count = end - start + 1;
  if (count <= 12) return Array.from({ length: count }, (_, i) => start + i);

  const useful = new Set<number>([start, end]);
  if (input.pageNumber >= start && input.pageNumber <= end) useful.add(input.pageNumber);
  const slots = 8;
  for (let i = 1; i < slots - 1; i++) {
    useful.add(Math.round(start + ((count - 1) * i) / (slots - 1)));
  }
  return Array.from(useful).sort((a, b) => a - b);
}
