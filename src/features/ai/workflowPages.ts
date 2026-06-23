export function pagesNeededForWorkflow(input: {
  mode: string;
  pageNumber: number;
  startPage?: number;
  endPage?: number;
}): number[] {
  if (input.mode !== "range_summary" || !input.startPage || !input.endPage) {
    return [input.pageNumber];
  }
  const start = Math.min(input.startPage, input.endPage);
  const end = Math.max(input.startPage, input.endPage);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
