function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function chapterToPercent(chapter: number, totalChapters: number): number {
  if (totalChapters <= 1) return 0;
  const safeChapter = clamp(Math.round(chapter), 1, totalChapters);
  return Math.round(((safeChapter - 1) / (totalChapters - 1)) * 100);
}

export function percentToChapter(percent: number, totalChapters: number): number {
  if (totalChapters <= 1) return 1;
  const safePercent = clamp(Math.round(percent), 0, 100);
  return clamp(Math.round((safePercent / 100) * (totalChapters - 1)) + 1, 1, totalChapters);
}
