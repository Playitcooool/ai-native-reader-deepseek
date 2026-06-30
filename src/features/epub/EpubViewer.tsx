import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ePub from "epubjs";
import type { Book, Rendition } from "epubjs";
import { useDocumentStore } from "../../stores/documentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { Icon } from "../../components/Icons";
import EpubInkOverlay from "../ink/EpubInkOverlay";
import InkToolbarControls from "../ink/InkToolbarControls";
import type { InkToolState } from "../ink/inkGeometry";

interface EpubViewerProps {
  documentId: string;
  onBackHome?: () => void;
  onOpenLibrary?: () => void;
  onOpenAi?: (draft?: string) => void;
}

export default function EpubViewer({ documentId, onBackHome, onOpenLibrary, onOpenAi }: EpubViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const { currentDocument, setCurrentPage, setTocNodes } = useDocumentStore();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fontSize, setFontSize] = useState(100);
  const [progress, setProgress] = useState(currentDocument?.last_page ?? 0);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [isRtl, setIsRtl] = useState(false);
  const [inkRefreshKey, setInkRefreshKey] = useState(0);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [rendition, setRendition] = useState<Rendition | null>(null);
  const [inkToolState, setInkToolState] = useState<InkToolState>({
    activeTool: "none",
    color: "#111827",
    penWidth: 4,
  });
  const setContainerRef = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setContainerEl(element);
  }, []);

  // Load EPUB
  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;
    setLoading(true);
    setError(null);
    setProgress(currentDocument?.last_page ?? 0);
    setAtStart(true);
    setAtEnd(false);

    const load = async () => {
      try {
        const data = await invoke<number[] | Uint8Array>("read_document_bytes", { documentId });
        const book = ePub(new Uint8Array(data).buffer as ArrayBuffer);
        await book.ready;
        if (destroyed) return;
        bookRef.current = book;
        setIsRtl((book as any).package?.metadata?.direction === "rtl");

        const rendition = book.renderTo(containerRef.current!, {
          manager: "continuous",
          flow: "paginated",
          width: "100%",
          height: "100%",
          spread: "auto",
          minSpreadWidth: 900,
        });
        applyEpubTheme(rendition, theme);
        renditionRef.current = rendition;
        setRendition(rendition);

        rendition.on("relocated", (location: any) => {
          const percentage = location?.start?.percentage;
          if (typeof percentage === "number") {
            const pct = Math.max(0, Math.min(100, Math.round(percentage * 100)));
            setProgress(pct);
            setCurrentPage(pct);
            invoke("update_last_page", { documentId, pageNumber: pct }).catch(() => {});
          }
          setAtStart(Boolean(location?.atStart));
          setAtEnd(Boolean(location?.atEnd));
        });

        await book.locations.generate(100);

        // Restore position (last_page as 0-100 progress percentage)
        const startPct = currentDocument?.last_page ?? 0;
        if (startPct > 0) {
          const target = book.locations.cfiFromPercentage(startPct / 100);
          await rendition.display(target);
        } else {
          await rendition.display();
        }
        if (!destroyed) setLoading(false);

        // Extract TOC from epubjs navigation
        const nav = book.navigation?.toc ?? [];
        if (nav.length > 0) {
          const flattenNav = (items: any[], level: number, order: { v: number }): any[] => {
            const result: any[] = [];
            for (const item of items) {
              result.push({
                id: `${documentId}-toc-${order.v}`,
                title: item.label,
                level,
                start_page: order.v + 1,
                end_page: null,
                order_index: order.v,
              });
              order.v++;
              if (item.subitems?.length) {
                result.push(...flattenNav(item.subitems, level + 1, order));
              }
            }
            return result;
          };
          const flat = flattenNav(nav, 0, { v: 0 });
          setTocNodes(flat);
        }
      } catch (err) {
        if (!destroyed) {
          setError(`Failed to load EPUB: ${err}`);
          setLoading(false);
        }
      }
    };
    load();

    return () => {
      destroyed = true;
      renditionRef.current?.destroy();
      setRendition(null);
      bookRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // Apply font size
  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes?.fontSize(`${fontSize}%`);
  }, [fontSize]);

  useEffect(() => {
    if (!renditionRef.current) return;
    applyEpubTheme(renditionRef.current, theme);
  }, [theme]);

  const goPrevious = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition || atStart) return;
    const turn = isRtl ? rendition.next() : rendition.prev();
    Promise.resolve(turn).catch(() => {});
  }, [atStart, isRtl]);

  const goNext = useCallback(() => {
    const rendition = renditionRef.current;
    if (!rendition || atEnd) return;
    const turn = isRtl ? rendition.prev() : rendition.next();
    Promise.resolve(turn).catch(() => {});
  }, [atEnd, isRtl]);

  useEffect(() => {
    const refresh = () => setInkRefreshKey((key) => key + 1);
    window.addEventListener("annotations-changed", refresh);
    return () => window.removeEventListener("annotations-changed", refresh);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setTheme(theme === "light" ? "dark" : "light");
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "Escape") {
        setInkToolState((state) => ({ ...state, activeTool: "none" }));
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goPrevious();
      }
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        goNext();
      }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setFontSize((s) => Math.min(200, s + 10)); }
      if (e.key === "-") { e.preventDefault(); setFontSize((s) => Math.max(50, s - 10)); }
      if (e.key === "0") { e.preventDefault(); setFontSize(100); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrevious, theme, setTheme]);

  // Debounced zoom (font size) persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentDocument) {
        invoke("update_last_zoom", { documentId, zoom: fontSize / 100 }).catch(() => {});
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [fontSize, documentId, currentDocument]);

  return (
    <div className="pdf-viewer">
      <div className="reader-toolbar">
        <button className="toolbar-text-button" onClick={onBackHome} aria-label="Back to home">
          <Icon name="home" />
          Back to home
        </button>
        <span className="toolbar-divider" />
        <button className="icon-button" onClick={goPrevious} disabled={atStart || loading} aria-label="Previous page"><Icon name="prev" /></button>
        <span className="page-control">
          <span>{loading ? "Loading" : `${progress}%`}</span>
        </span>
        <button className="icon-button" onClick={goNext} disabled={atEnd || loading} aria-label="Next page"><Icon name="next" /></button>
        <button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Switch theme (Cmd+Shift+T)" aria-label="Toggle theme">
          <Icon name={theme === "light" ? "moon" : "sun"} />
        </button>
        <InkToolbarControls value={inkToolState} onChange={setInkToolState} />
        <span className="toolbar-center">
          <button className="toolbar-text-button" onClick={onOpenLibrary} aria-label="Open library">
            <Icon name="books" />
            Library
          </button>
          <button className="toolbar-text-button" onClick={() => onOpenAi?.()} aria-label="Open AI assistant">
            <Icon name="ask" />
            Ask
          </button>
        </span>
        <span className="toolbar-spacer" />
        <button className="icon-button" onClick={() => setFontSize((s) => Math.max(50, s - 10))} disabled={fontSize <= 50} aria-label="Zoom out"><Icon name="minus" /></button>
        <button className="zoom-reset" onClick={() => setFontSize(100)}>{fontSize}%</button>
        <button className="icon-button" onClick={() => setFontSize((s) => Math.min(200, s + 10))} disabled={fontSize >= 200} aria-label="Zoom in"><Icon name="plus" /></button>
      </div>

      {error ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <p style={{ color: "var(--danger-color)" }}>{error}</p>
        </div>
      ) : (
        <div className="epub-reader-frame">
          {loading && <div className="epub-loading">Loading EPUB...</div>}
          <div
            ref={setContainerRef}
            className="epub-scroll"
          />
          {!loading && (
            <>
              <button className="epub-page-turn epub-page-turn-prev" onClick={goPrevious} disabled={atStart} aria-label="Previous page">
                <Icon name="prev" />
              </button>
              <button className="epub-page-turn epub-page-turn-next" onClick={goNext} disabled={atEnd} aria-label="Next page">
                <Icon name="next" />
              </button>
            </>
          )}
          <EpubInkOverlay
            documentId={documentId}
            container={containerEl}
            rendition={rendition}
            toolState={inkToolState}
            refreshKey={inkRefreshKey}
            onChanged={() => setInkRefreshKey((key) => key + 1)}
          />
        </div>
      )}
    </div>
  );
}

function applyEpubTheme(rendition: Rendition, theme: "light" | "dark") {
  const background = theme === "dark" ? "#25211d" : "#f2efe9";
  const color = theme === "dark" ? "#f5f5f7" : "#1d1d1f";
  (rendition.themes as any)?.default?.({
    html: { "overflow-x": "hidden !important", background },
    body: {
      "overflow-x": "hidden !important",
      background,
      color,
    },
  });
}
