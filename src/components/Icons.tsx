type IconName = "home" | "books" | "ask" | "prev" | "next" | "search" | "moon" | "sun" | "minus" | "plus" | "close";

export function Icon({ name }: { name: IconName }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, JSX.Element> = {
    books: <><path d="M4 19.5V5a2 2 0 0 1 2-2h11" /><path d="M6 17h13" /><path d="M6 21h13V7H6a2 2 0 0 0 0 4" /></>,
    home: <><path d="m15 18-6-6 6-6" /><path d="M20 12H9" /><path d="M5 19V5" /></>,
    ask: <><path d="M12 3a7 7 0 0 1 7 7c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 7-7Z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>,
    prev: <><path d="m15 18-6-6 6-6" /></>,
    next: <><path d="m9 18 6-6-6-6" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    moon: <><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.3 17.7-1.4 1.4" /><path d="m19.1 4.9-1.4 1.4" /></>,
    minus: <><path d="M5 12h14" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  };
  return <svg aria-hidden="true" {...common}>{paths[name]}</svg>;
}
