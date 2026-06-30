const PAGE_GUTTER_PX = 48;
const MIN_INITIAL_ZOOM = 0.5;
const MAX_INITIAL_ZOOM = 1.75;

export function computeInitialPdfZoom(containerWidth: number, pageWidth: number): number {
  if (containerWidth <= 0 || pageWidth <= 0) return 1;
  const fitWidth = (containerWidth - PAGE_GUTTER_PX) / pageWidth;
  return Math.max(MIN_INITIAL_ZOOM, Math.min(MAX_INITIAL_ZOOM, fitWidth));
}
