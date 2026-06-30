import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "../pdfjs";
import { useDocumentStore } from "../stores/documentStore";
import { useSettingsStore } from "../stores/settingsStore";
import { setOcrPdfRef } from "../stores/aiStore";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { extractToc, type TocNodeInput } from "../features/toc/tocTree";
import {
  PageExtractionQueue,
  ensureDocumentTextReady,
  extractPageText,
  samplePagesForOpen,
} from "../features/pdf/pdfTextExtraction";
import SelectionMenu from "../features/pdf/SelectionMenu";
import PageView from "../features/pdf/PageView";
import { findPageIndexAtOffset, useVisibleRange } from "../features/pdf/useVisibleRange";
import { computeInitialPdfZoom } from "../features/pdf/pdfInitialZoom";
import InkToolbarControls from "../features/ink/InkToolbarControls";
import type { InkToolState } from "../features/ink/inkGeometry";
import { useToast } from "./Toast";
import ShortcutsModal from "./ShortcutsModal";
import { Icon } from "./Icons";
import { draftFromSelection } from "../features/ai/aiPanelHelpers";
import { isTauriRuntime } from "../tauriRuntime";
import type { Annotation } from "../stores/notesStore";

const initialZoomKey = (documentId: string) => `rustybooks:pdf-initial-zoom:${documentId}`;

interface PdfViewerProps {
  documentId: string;
  onBackHome?: () => void;
  onOpenLibrary?: () => void;
  onOpenAi?: (draft?: string) => void;
}

export default function PdfViewer({ documentId, onBackHome, onOpenLibrary, onOpenAi }: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<any>(null);
  const [highlightRefreshKey, setHighlightRefreshKey] = useState(0);
  const [inkToolState, setInkToolState] = useState<InkToolState>({
    activeTool: "none",
    color: "#111827",
    penWidth: 4,
  });
  const [pageCount, setPageCount] = useState(0);
  const [basePageHeight, setBasePageHeight] = useState(0);
  const [basePageWidth, setBasePageWidth] = useState(0);
  const [pageHeights, setPageHeights] = useState<number[]>([]);
  const {
    currentPage,
    zoom,
    setCurrentPage,
    setTotalPages,
    setZoom,
    setActiveTocNodeId,
    tocNodes,
    loadToc,
    currentDocument,
  } = useDocumentStore();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const { addToast } = useToast();
  const extractionRef = useRef<PageExtractionQueue | null>(null);
  const progScrollRef = useRef(false);
  const scrollPageUpdateRef = useRef<number | null>(null);
  const pageDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomAnchorRef = useRef<{ oldScrollTop: number; oldZoom: number } | null>(null);
  const lastJumpKeyRef = useRef("");
  const pageTopsRef = useRef<number[]>([]);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ pageNum: number; context: string }>>([]);
  const [currentResultIdx, setCurrentResultIdx] = useState(0);
  const [extractionDone, setExtractionDone] = useState(0);
  const extractionTotal = useRef(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchPhase, setSearchPhase] = useState("");
  const [loadProgress, setLoadProgress] = useState(0);
  const [indexedPageCount, setIndexedPageCount] = useState(0);
  const [annotationsByPage, setAnnotationsByPage] = useState<Record<number, Annotation[]>>({});
  const searchCancelledRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => setHighlightRefreshKey((key) => key + 1);
    window.addEventListener("annotations-changed", refresh);
    return () => window.removeEventListener("annotations-changed", refresh);
  }, []);

  // Compute page heights from base viewport and zoom
  const pageHeightAtZoom = basePageHeight * zoom;
  const pageWidthAtZoom = basePageWidth * zoom;
  const heights = useMemo(
    () => pageHeights.map((h) => h * zoom),
    [pageHeights, zoom],
  );

  // Visible range from virtual scroll
  const { visibleRange, totalHeight, pageTops } = useVisibleRange({
    pageCount,
    pageHeights: heights,
    bufferPages: 2,
    scrollContainerRef: scrollRef as React.RefObject<HTMLElement | null>,
  });

  pageTopsRef.current = pageTops;

  // Programmatic scroll (TOC, citations, keyboard arrows, doc restore)
  // MUST be declared before the page detection effect so progScrollRef is set
  // before page detection checks it, preventing oscillation on document restore.
  useEffect(() => {
    if (!currentDocument || heights.length === 0 || pageCount === 0) return;
    const container = scrollRef.current;
    if (!container) return;
    const page = Math.max(1, Math.min(pageCount, currentPage));
    if (page !== currentPage) {
      setCurrentPage(page);
      return;
    }
    if (scrollPageUpdateRef.current === currentPage) {
      scrollPageUpdateRef.current = null;
      return;
    }
    scrollPageUpdateRef.current = null;
    const jumpKey = `${documentId}:${page}`;
    if (lastJumpKeyRef.current === jumpKey) return;
    lastJumpKeyRef.current = jumpKey;
    progScrollRef.current = true;
    container.scrollTop = pageTopsRef.current[page - 1] ?? 0;
    const raf = requestAnimationFrame(() => {
      progScrollRef.current = false;
    });
    return () => {
      cancelAnimationFrame(raf);
      progScrollRef.current = false;
    };
  }, [currentDocument, currentPage, documentId, heights.length, pageCount, setCurrentPage]);

  // Derive current page from scroll position — debounced to store
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || heights.length === 0) return;
    const center = container.scrollTop + container.clientHeight / 2;
    const page = findPageIndexAtOffset(pageTops, center) + 1;
    if (page !== currentPage && !progScrollRef.current) {
      scrollPageUpdateRef.current = page;
      setCurrentPage(page);
      if (pageDebounceRef.current) clearTimeout(pageDebounceRef.current);
      pageDebounceRef.current = setTimeout(() => {
        invoke("update_last_page", { documentId, pageNumber: page }).catch(() => {});
      }, 150);
    }
  }, [visibleRange, heights.length, pageTops, currentPage, setCurrentPage, documentId]);

  // Dispose debounce on unmount
  useEffect(() => {
    return () => {
      if (pageDebounceRef.current) clearTimeout(pageDebounceRef.current);
    };
  }, []);

  // Load PDF
  useEffect(() => {
    let destroyed = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const loadPdf = async () => {
      try {
        setLoadProgress(0);
        const onProgress = (loaded: number, total: number) => {
          if (total > 0) setLoadProgress(Math.round((loaded / total) * 100));
        };
        const loadFromBytes = async () => {
          const data = await invoke<number[] | Uint8Array>("read_document_bytes", { documentId });
          const task = pdfjsLib.getDocument({ data: new Uint8Array(data) });
          task.onProgress = onProgress;
          return task.promise;
        };
        const filePath = currentDocument?.file_path;
        let pdf: PDFDocumentProxy;
        if (isTauriRuntime() && filePath) {
          const task = pdfjsLib.getDocument({ url: convertFileSrc(filePath) });
          task.onProgress = onProgress;
          pdf = await task.promise.catch(loadFromBytes);
        } else {
          pdf = await loadFromBytes();
        }
        if (destroyed) { pdf.destroy(); return; }
        pdfRef.current = pdf;
        setOcrPdfRef(pdf);
        setTotalPages(pdf.numPages);
        setPageCount(pdf.numPages);
        invoke("update_page_count", { documentId, pageCount: pdf.numPages }).catch(() => {});

        // Get page 1 viewport for base dimensions
        const p1 = await pdf.getPage(1);
        const vp = p1.getViewport({ scale: 1 });
        setBasePageHeight(vp.height);
        setBasePageWidth(vp.width);
        setPageHeights(new Array(pdf.numPages).fill(vp.height));
        p1.cleanup();

        const tocInput = await extractToc(pdf, pdf.numPages);
        if (destroyed) return;
        if (tocInput.length > 0) {
          await invoke<TocNodeInput[]>("save_toc_nodes", { documentId, nodes: tocInput });
        }
        await loadToc(documentId);

        const eq = new PageExtractionQueue(
          pdf, documentId,
          (docId, pages) => invoke("save_pages_text", { documentId: docId, pages }),
          (docId, pageNum) => invoke("mark_page_text_failed", { documentId: docId, pageNumber: pageNum }),
        );
        eq.onProgress = (done, total) => { setExtractionDone(done); extractionTotal.current = total; };
        extractionRef.current = eq;
        const samplePages = samplePagesForOpen(currentPage, pdf.numPages);

        const sampledText = await Promise.all(samplePages.map(async (pageNumber) => {
          try {
            const result = await extractPageText(pdf, pageNumber);
            if (result.text.trim()) {
              await invoke("save_pages_text", {
                documentId,
                pages: [{ pageNumber, text: result.text }],
              });
            }
            return result.text.trim();
          } catch {
            return "";
          }
        }));

        if (!destroyed && sampledText.length > 0 && sampledText.every((text) => !text)) {
          idleTimer = setTimeout(() => {
            ensureDocumentTextReady(documentId, pdf.numPages, {
              pdf,
              isCancelled: () => destroyed,
            }).then(() =>
              invoke<number>("count_indexed_pages", { documentId }).then(setIndexedPageCount).catch(() => {})
            ).catch(() => {});
          }, 1000);
        }
      } catch (err) {
        if (!destroyed) setError(`Failed to load PDF: ${err}`);
      }
    };
    loadPdf();
    return () => {
      destroyed = true;
      if (idleTimer) clearTimeout(idleTimer);
      extractionRef.current?.destroy();
      pdfRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    if (currentDocument?.document_type !== "pdf" || basePageWidth <= 0 || pageCount <= 0) return;
    const key = initialZoomKey(documentId);
    if (localStorage.getItem(key)) return;
    const containerWidth = scrollRef.current?.clientWidth ?? 0;
    if (containerWidth <= 0) return;
    const nextZoom = computeInitialPdfZoom(containerWidth, basePageWidth);
    localStorage.setItem(key, "1");
    setZoom(nextZoom);
    invoke("update_last_zoom", { documentId, zoom: nextZoom }).catch(() => {});
  }, [basePageWidth, currentDocument?.document_type, documentId, pageCount, setZoom]);

  // Update extraction priority when visible range changes
  useEffect(() => {
    if (extractionRef.current && pageCount > 0) {
      extractionRef.current.setCurrentPage(currentPage, pageCount);
    }
  }, [currentPage, pageCount]);

  useEffect(() => {
    if (!documentId) return;
    invoke<number>("count_indexed_pages", { documentId })
      .then(setIndexedPageCount)
      .catch(() => {});
  }, [documentId, extractionDone]);

  // Active TOC node — derive from currentPage
  useEffect(() => {
    if (tocNodes.length === 0 || currentPage < 1) {
      setActiveTocNodeId(null);
      return;
    }
    let best: typeof tocNodes[0] | null = null;
    for (const node of tocNodes) {
      if (node.start_page <= currentPage && (node.end_page === null || currentPage <= node.end_page)) {
        if (!best || node.level > best.level) best = node;
      }
    }
    setActiveTocNodeId(best?.id ?? null);
  }, [currentPage, tocNodes, setActiveTocNodeId]);

  // Text selection
  const handleTextSelection = useCallback(
    (text: string, anchor: any) => {
      setSelectionText(text);
      setSelectionAnchor(anchor);
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setSelectionPos({ x: rect.left + rect.width / 2, y: rect.top });
      }
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelectionText("");
    setSelectionAnchor(null);
    setSelectionPos(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  // Handle Explain action
  const handleExplain = useCallback(() => {
    if (!selectionText) return;
    onOpenAi?.(draftFromSelection(selectionText));
    clearSelection();
  }, [selectionText, onOpenAi, clearSelection]);

  // Handle Translate action
  const handleTranslate = useCallback(async (text: string) => {
    if (!currentDocument) return null;
    try {
      return await invoke<string>("translate_text", {
        input: { selected_text: text },
      });
    } catch (err) {
      addToast({ type: "error", message: "Translation failed." });
      return null;
    }
  }, [addToast]);

  // Scroll to page (used by keyboard nav)
  const goToPage = useCallback(
    (page: number) => {
      const pdf = pdfRef.current;
      if (!pdf) return;
      const p = Math.max(1, Math.min(pdf.numPages, page));
      if (p !== currentPage) {
        if (pageDebounceRef.current) clearTimeout(pageDebounceRef.current);
        setCurrentPage(p);
        clearSelection();
        invoke("update_last_page", { documentId, pageNumber: p }).catch(() => {});
      }
    },
    [currentPage, documentId, setCurrentPage, clearSelection],
  );

  // Zoom with scroll-position preservation
  const handleSetZoom = useCallback(
    (newZoom: number) => {
      const clamped = Math.max(0.25, Math.min(4.0, newZoom));
      const container = scrollRef.current;
      if (container) {
        zoomAnchorRef.current = { oldScrollTop: container.scrollTop, oldZoom: zoom };
      }
      setZoom(clamped);
    },
    [zoom, setZoom],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+Shift+T toggles theme
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setTheme(theme === "light" ? "dark" : "light");
        return;
      }
      // Let system shortcuts (Cmd+C/V/A, etc.) pass through
      if (e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // When shortcut help is open, only allow Escape or ? to close it
      if (showShortcuts) {
        if (e.key === "Escape" || e.key === "?") { setShowShortcuts(false); }
        e.preventDefault();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goToPage(currentPage - 1); }
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goToPage(currentPage + 1); }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); handleSetZoom(zoom + 0.25); }
      if (e.key === "-") { e.preventDefault(); handleSetZoom(zoom - 0.25); }
      if (e.key === "0") { e.preventDefault(); handleSetZoom(1.0); }
      if ((e.key === "e" || e.key === "E") && selectionText) {
        e.preventDefault();
        handleExplain();
      }
      if (e.key === "Escape") {
        clearSelection();
        setShowShortcuts(false);
        setInkToolState((state) => ({ ...state, activeTool: "none" }));
      }
      if (e.key === "?") { setShowShortcuts((p) => !p); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentPage, zoom, goToPage, handleSetZoom, clearSelection, selectionText, handleExplain, showShortcuts, theme, setTheme]);

  // Debounced zoom persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      invoke("update_last_zoom", { documentId, zoom }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [zoom, documentId]);

  // Preserve scroll position on zoom change
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    if (anchor && anchor.oldZoom !== zoom && heights.length > 0) {
      const ratio = zoom / anchor.oldZoom;
      const container = scrollRef.current;
      if (container) {
        container.scrollTop = anchor.oldScrollTop * ratio;
      }
      zoomAnchorRef.current = null;
    }
  }, [zoom, heights]);

  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setSearchResults([]); return; }
    searchCancelledRef.current = false;
    setIsSearching(true);
    setSearchPhase("Preparing text");
    try {
      if (pdfRef.current && pageCount > 0) {
        await ensureDocumentTextReady(documentId, pageCount, {
          pdf: pdfRef.current,
          isCancelled: () => searchCancelledRef.current,
          onPhase: (phase, pageNumber) => setSearchPhase(phase === "ocr" ? `OCR page ${pageNumber}` : `Preparing page ${pageNumber}`),
        });
        if (searchCancelledRef.current) return;
        invoke<number>("count_indexed_pages", { documentId }).then(setIndexedPageCount).catch(() => {});
      }
      setSearchPhase("Searching");
      const results = await invoke<Array<{ pageNum: number; context: string }>>("search_pages_text", {
        documentId,
        query,
        limit: 200,
      });
      if (searchCancelledRef.current) return;
      setSearchResults(results);
      setCurrentResultIdx(0);
      if (results.length > 0) setCurrentPage(results[0].pageNum);
    } finally {
      setIsSearching(false);
      setSearchPhase("");
    }
  }, [documentId, pageCount, setCurrentPage]);

  // Cancel search on unmount
  useEffect(() => {
    return () => { searchCancelledRef.current = true; };
  }, []);

  const goToSearchResult = useCallback((idx: number) => {
    if (idx < 0 || idx >= searchResults.length) return;
    setCurrentResultIdx(idx);
    setCurrentPage(searchResults[idx].pageNum);
  }, [searchResults, setCurrentPage]);

  const handleToggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      if (prev) {
        searchCancelledRef.current = true;
        setSearchQuery("");
        setSearchResults([]);
        setCurrentResultIdx(0);
      }
      return !prev;
    });
  }, []);

  // Build visible page list
  const pageNumbers = useMemo(() => {
    const nums: number[] = [];
    for (let i = visibleRange[0]; i <= visibleRange[1]; i++) {
      nums.push(i + 1); // 1-based page numbers
    }
    return nums;
  }, [visibleRange]);

  useEffect(() => {
    let dead = false;
    if (pageNumbers.length === 0) {
      setAnnotationsByPage({});
      return;
    }
    invoke<Annotation[]>("get_annotations_for_pages", { documentId, pageNumbers })
      .then((rows) => {
        if (dead) return;
        const next: Record<number, Annotation[]> = {};
        for (const row of rows) {
          (next[row.page_number] ??= []).push(row);
        }
        setAnnotationsByPage(next);
      })
      .catch(() => {
        if (!dead) setAnnotationsByPage({});
      });
    return () => { dead = true; };
  }, [documentId, highlightRefreshKey, pageNumbers]);

  return (
    <div className="pdf-viewer">
      {/* Toolbar */}
      <div className="reader-toolbar">
        <button className="toolbar-text-button" onClick={onBackHome} aria-label="Back to home">
          <Icon name="home" />
          Back to home
        </button>
        <span className="toolbar-divider" />
        <button className="icon-button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page"><Icon name="prev" /></button>
        <span className="page-control">
          <input
            type="number" value={currentPage} min={1} max={pageCount || 1}
            onChange={(e) => goToPage(Number(e.target.value))}
          />{" "}
          <span>/ {pageCount || "?"}</span>
        </span>
        <button className="icon-button" onClick={() => goToPage(currentPage + 1)} disabled={!pdfRef.current || currentPage >= pageCount} aria-label="Next page"><Icon name="next" /></button>
        <button className={`icon-button ${showSearch ? "active" : ""}`} onClick={handleToggleSearch} title="Search (Ctrl+F)" aria-label="Toggle search">
          <Icon name="search" />
        </button>
        <button className="icon-button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Switch to light/dark mode (Cmd+Shift+T)" aria-label="Toggle theme">
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
        <button className="icon-button" onClick={() => handleSetZoom(zoom - 0.25)} disabled={zoom <= 0.25} aria-label="Zoom out"><Icon name="minus" /></button>
        <button className="zoom-reset" onClick={() => handleSetZoom(1.0)}>{Math.round(zoom * 100)}%</button>
        <button className="icon-button" onClick={() => handleSetZoom(zoom + 0.25)} disabled={zoom >= 4.0} aria-label="Zoom in"><Icon name="plus" /></button>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="search-bar">
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") performSearch(searchQuery); }}
            placeholder="Search in document…"
            autoFocus
          />
          <button onClick={() => performSearch(searchQuery)} disabled={isSearching || !searchQuery.trim()}
            className="primary-action">
            {isSearching ? "Searching" : "Search"}
          </button>
          <span className="search-status">
            {searchPhase
              ? searchPhase
              : indexedPageCount === 0
              ? "Waiting for index"
              : extractionDone < extractionTotal.current
                ? `Indexed results (${indexedPageCount}/${pageCount})`
                : `Indexed results (${indexedPageCount})`}
          </span>
          {!isSearching && searchResults.length > 0 && (
            <>
              <span className="search-count">
                {currentResultIdx + 1} / {searchResults.length}
              </span>
              <button onClick={() => goToSearchResult(currentResultIdx - 1)} disabled={currentResultIdx <= 0} aria-label="Previous search result"
                className="icon-button"><Icon name="prev" /></button>
              <button onClick={() => goToSearchResult(currentResultIdx + 1)} disabled={currentResultIdx >= searchResults.length - 1} aria-label="Next search result"
                className="icon-button"><Icon name="next" /></button>
            </>
          )}
          {!isSearching && searchQuery && searchResults.length === 0 && (
            <span className="search-status">No results</span>
          )}
          <button onClick={handleToggleSearch} aria-label="Close search" className="icon-button"><Icon name="close" /></button>
        </div>
      )}

      {/* Scroll container */}
      <div
        ref={scrollRef}
        className="pdf-scroll"
      >
        {error ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <p style={{ color: "var(--danger-color)", marginBottom: 8 }}>{error}</p>
          </div>
        ) : pageCount === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ marginBottom: 12, fontSize: 13 }}>Loading PDF{loadProgress > 0 ? ` (${loadProgress}%)` : "..."}</div>
            {loadProgress > 0 && (
              <div style={{
                width: 240, height: 6, margin: "0 auto",
                background: "var(--bg-tertiary)", borderRadius: 3,
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${loadProgress}%`, height: "100%",
                  background: "var(--accent-color)", borderRadius: 3,
                  transition: "width 0.15s ease",
                }} />
              </div>
            )}
          </div>
        ) : (
          <div style={{ height: totalHeight, position: "relative", width: "100%" }}>
            {pageNumbers.map((pageNum) => {
              const idx = pageNum - 1;
              return (
                <PageView
                  key={pageNum}
                  pageNum={pageNum}
                  documentId={documentId}
                  pdf={pdfRef.current!}
                  zoom={zoom}
                  top={pageTops[idx] ?? 0}
                  width={pageWidthAtZoom}
                  height={pageHeightAtZoom}
                  annotations={annotationsByPage[pageNum] ?? []}
                  inkToolState={inkToolState}
                  onSelection={handleTextSelection}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Selection menu */}
      {selectionText && (
        <SelectionMenu
          selectedText={selectionText}
          pageNumber={currentPage}
          documentId={documentId}
          anchor={selectionAnchor}
          position={selectionPos}
          onClose={clearSelection}
          onAsk={(text) => {
            onOpenAi?.(draftFromSelection(text));
          }}
          onExplain={handleExplain}
          onTranslate={handleTranslate}
        />
      )}

      {/* Keyboard shortcut help */}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
