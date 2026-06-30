import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore } from "../../stores/documentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useNotesStore } from "../../stores/notesStore";
import { Icon } from "../../components/Icons";
import InkCanvasOverlay from "../ink/InkCanvasOverlay";
import InkToolbarControls from "../ink/InkToolbarControls";
import type { InkToolState } from "../ink/inkGeometry";
import { chapterToPercent, percentToChapter } from "./epubProgress";

interface EpubViewerProps {
  documentId: string;
  onBackHome?: () => void;
  onOpenLibrary?: () => void;
  onOpenAi?: (draft?: string) => void;
}

interface PageText {
  page_number: number;
  text: string | null;
  text_status: string;
}

export default function EpubViewer({ documentId, onBackHome, onOpenLibrary, onOpenAi }: EpubViewerProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);
  const { currentDocument, currentPage, setCurrentPage, setTotalPages, loadToc, tocNodes, setActiveTocNodeId } = useDocumentStore();
  const annotations = useNotesStore((s) => s.annotations);
  const loadAnnotations = useNotesStore((s) => s.loadAnnotations);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const [chapters, setChapters] = useState<PageText[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fontSize, setFontSize] = useState(() => Math.round((currentDocument?.last_zoom ?? 1) * 100));
  const [articleSize, setArticleSize] = useState({ width: 0, height: 0 });
  const [inkRefreshKey, setInkRefreshKey] = useState(0);
  const [inkToolState, setInkToolState] = useState<InkToolState>({
    activeTool: "none",
    color: "#111827",
    penWidth: 4,
  });

  const totalChapters = chapters.length || currentDocument?.page_count || 1;
  const chapter = Math.max(1, Math.min(totalChapters, currentPage || 1));
  const currentChapter = chapters[chapter - 1];
  const progress = chapterToPercent(chapter, totalChapters);
  const atStart = chapter <= 1;
  const atEnd = chapter >= totalChapters;
  const inkAnnotations = useMemo(
    () => annotations.filter((a) => a.type === "ink" && a.page_number === chapter),
    [annotations, chapter, inkRefreshKey],
  );

  const goToChapter = useCallback((next: number) => {
    const page = Math.max(1, Math.min(totalChapters, next));
    setCurrentPage(page);
    invoke("update_last_page", { documentId, pageNumber: chapterToPercent(page, totalChapters) }).catch(() => {});
    frameRef.current?.scrollTo({ top: 0 });
  }, [documentId, setCurrentPage, totalChapters]);

  const goPrevious = useCallback(() => {
    if (!atStart) goToChapter(chapter - 1);
  }, [atStart, chapter, goToChapter]);

  const goNext = useCallback(() => {
    if (!atEnd) goToChapter(chapter + 1);
  }, [atEnd, chapter, goToChapter]);

  useEffect(() => {
    let dead = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const requestedEnd = currentDocument?.page_count || 10_000;
        let rows = await invoke<PageText[]>("get_pages_text", { documentId, startPage: 1, endPage: requestedEnd });
        if (currentDocument?.parse_status !== "ready" || rows.length === 0 || rows.some((row) => row.text_status !== "ready")) {
          const count = await invoke<number>("extract_epub_content", { documentId, filePath: currentDocument?.file_path ?? "" });
          rows = await invoke<PageText[]>("get_pages_text", { documentId, startPage: 1, endPage: count || requestedEnd });
        }
        if (dead) return;
        const ready = rows.filter((row) => row.text_status === "ready");
        setChapters(ready);
        setTotalPages(ready.length);
        loadToc(documentId).catch(() => {});
        loadAnnotations(documentId).catch(() => {});
        setCurrentPage(percentToChapter(currentDocument?.last_page ?? 0, ready.length || 1));
      } catch (err) {
        if (!dead) setError(`Failed to load EPUB: ${err}`);
      } finally {
        if (!dead) setLoading(false);
      }
    }
    load();
    return () => { dead = true; };
  }, [currentDocument?.file_path, currentDocument?.last_page, currentDocument?.page_count, currentDocument?.parse_status, documentId, loadAnnotations, loadToc, setCurrentPage, setTotalPages]);

  useEffect(() => {
    const element = articleRef.current;
    if (!element) return;
    const update = () => setArticleSize({ width: element.offsetWidth, height: element.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [chapter, currentChapter?.text, fontSize]);

  useEffect(() => {
    let best: typeof tocNodes[0] | null = null;
    for (const node of tocNodes) {
      if (node.start_page <= chapter && (node.end_page === null || chapter <= node.end_page)) best = node;
    }
    setActiveTocNodeId(best?.id ?? null);
  }, [chapter, setActiveTocNodeId, tocNodes]);

  useEffect(() => {
    const refresh = () => {
      setInkRefreshKey((key) => key + 1);
      loadAnnotations(documentId).catch(() => {});
    };
    window.addEventListener("annotations-changed", refresh);
    return () => window.removeEventListener("annotations-changed", refresh);
  }, [documentId, loadAnnotations]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setTheme(theme === "light" ? "dark" : "light");
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") setInkToolState((state) => ({ ...state, activeTool: "none" }));
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goPrevious(); }
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); goNext(); }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setFontSize((s) => Math.min(200, s + 10)); }
      if (e.key === "-") { e.preventDefault(); setFontSize((s) => Math.max(50, s - 10)); }
      if (e.key === "0") { e.preventDefault(); setFontSize(100); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrevious, theme, setTheme]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentDocument) invoke("update_last_zoom", { documentId, zoom: fontSize / 100 }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [fontSize, documentId, currentDocument]);

  return (
    <div className="pdf-viewer">
      <div className="reader-toolbar">
        <button className="toolbar-text-button" onClick={onBackHome} aria-label="Back to home"><Icon name="home" />Back to home</button>
        <span className="toolbar-divider" />
        <button className="icon-button" onClick={goPrevious} disabled={atStart || loading} aria-label="Previous chapter"><Icon name="prev" /></button>
        <span className="page-control"><span>{loading ? "Loading" : `Chapter ${chapter}/${totalChapters} - ${progress}%`}</span></span>
        <button className="icon-button" onClick={goNext} disabled={atEnd || loading} aria-label="Next chapter"><Icon name="next" /></button>
        <button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Switch theme (Cmd+Shift+T)" aria-label="Toggle theme">
          <Icon name={theme === "light" ? "moon" : "sun"} />
        </button>
        <InkToolbarControls value={inkToolState} onChange={setInkToolState} />
        <span className="toolbar-center">
          <button className="toolbar-text-button" onClick={onOpenLibrary} aria-label="Open library"><Icon name="books" />Library</button>
          <button className="toolbar-text-button" onClick={() => onOpenAi?.()} aria-label="Open AI assistant"><Icon name="ask" />Ask</button>
        </span>
        <span className="toolbar-spacer" />
        <button className="icon-button" onClick={() => setFontSize((s) => Math.max(50, s - 10))} disabled={fontSize <= 50} aria-label="Zoom out"><Icon name="minus" /></button>
        <button className="zoom-reset" onClick={() => setFontSize(100)}>{fontSize}%</button>
        <button className="icon-button" onClick={() => setFontSize((s) => Math.min(200, s + 10))} disabled={fontSize >= 200} aria-label="Zoom in"><Icon name="plus" /></button>
      </div>

      {error ? (
        <div style={{ padding: 24, textAlign: "center" }}><p style={{ color: "var(--danger-color)" }}>{error}</p></div>
      ) : (
        <div ref={frameRef} className="epub-reader-frame">
          {loading && <div className="epub-loading">Loading EPUB...</div>}
          {!loading && (
            <>
              <article ref={articleRef} className="epub-article" style={{ fontSize: `${fontSize}%` }}>
                {(currentChapter?.text || "").split(/\n{2,}|\r?\n/).filter(Boolean).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </article>
              <div className="epub-ink-layer">
                <div className="epub-ink-page" style={{ width: articleSize.width, height: articleSize.height }}>
                  <InkCanvasOverlay
                    documentId={documentId}
                    pageNumber={chapter}
                    width={articleSize.width}
                    height={articleSize.height}
                    annotations={inkAnnotations}
                    toolState={inkToolState}
                    space="epub-section"
                    sectionIndex={chapter - 1}
                    onChanged={() => setInkRefreshKey((key) => key + 1)}
                  />
                </div>
              </div>
              <button className="epub-page-turn epub-page-turn-prev" onClick={goPrevious} disabled={atStart} aria-label="Previous chapter"><Icon name="prev" /></button>
              <button className="epub-page-turn epub-page-turn-next" onClick={goNext} disabled={atEnd} aria-label="Next chapter"><Icon name="next" /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
