export function shouldFollowScroll(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = 72,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function draftFromSelection(text: string): string {
  return `About this selection:\n\n${text.trim()}`;
}
