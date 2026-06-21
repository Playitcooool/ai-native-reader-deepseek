import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocumentProxy } from "pdfjs-dist";
import "../pdfjs";
import { useDocumentStore } from "../stores/documentStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useAiStore } from "../stores/aiStore";
import { invoke } from "@tauri-apps/api/core";
import { extractToc, type TocNodeInput } from "../features/toc/tocTree";
import { PageExtractionQueue } from "../features/pdf/pdfTextExtraction";
import SelectionMenu from "../features/pdf/SelectionMenu";
import PageView from "../features/pdf/PageView";
import { useVisibleRange } from "../features/pdf/useVisibleRange";

interface PdfViewerProps {
  filePath: string;
  documentId: string;
}

export default function PdfViewer({ filePath, documentId }: PdfViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<any>(null);
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
    scrollToPage,
  } = useDocumentStore();
  const runWorkflow = useAiStore((s) => s.runWorkflow);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const extractionRef = useRef<PageExtractionQueue | null>(null);
  const progScrollRef = useRef(false);
  const pageDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomAnchorRef = useRef<{ oldScrollTop: number; oldZoom: number } | null>(null);

  // Search state
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ pageNum: number; context: string }>>([]);
  const [currentResultIdx, setCurrentResultIdx] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const searchCancelledRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Compute page heights from base viewport and zoom
  const pageHeightAtZoom = basePageHeight * zoom;
  const pageWidthAtZoom = basePageWidth * zoom;
  const heights = useMemo(
    () => pageHeights.map((h) => h * zoom),
    [pageHeights, zoom],
  );

  // Visible range from virtual scroll
  const { visibleRange, totalHeight } = useVisibleRange({
    pageCount,
    pageHeights: heights,
    bufferPages: 2,
    scrollContainerRef: scrollRef as React.RefObject<HTMLElement | null>,
  });

  // Programmatic scroll (TOC, citations, keyboard arrows, doc restore)
  // MUST be declared before the page detection effect so progScrollRef is set
  // before page detection checks it, preventing oscillation on document restore.
  useEffect(() => {
    if (!currentDocument || heights.length === 0) return;
    const container = scrollRef.current;
    if (!container) return;
    progScrollRef.current = true;
    let acc = 0;
    for (let i = 0; i < currentPage - 1 && i < heights.length; i++) {
      acc += heights[i];
    }
    container.scrollTop = acc;
    const raf = requestAnimationFrame(() => {
      progScrollRef.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [currentPage, heights.length]);

  // Derive current page from scroll position — debounced to store
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || heights.length === 0) return;
    const center = container.scrollTop + container.clientHeight / 2;
    let acc = 0;
    for (let i = 0; i < heights.length; i++) {
      acc += heights[i];
      if (center < acc) {
        const page = i + 1;
        if (page !== currentPage && !progScrollRef.current) {
          if (pageDebounceRef.current) clearTimeout(pageDebounceRef.current);
          pageDebounceRef.current = setTimeout(() => {
            setCurrentPage(page);
          }, 150);
        }
        break;
      }
    }
  }, [visibleRange, heights, currentPage, setCurrentPage]);

  // Dispose debounce on unmount
  useEffect(() => {
    return () => {
      if (pageDebounceRef.current) clearTimeout(pageDebounceRef.current);
    };
  }, []);

  // Load PDF
  useEffect(() => {
    let destroyed = false;
    const loadPdf = async () => {
      try {
        const b64 = await invoke<string>("read_file_bytes", { filePath });
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (destroyed) { pdf.destroy(); return; }
        pdfRef.current = pdf;
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
          (docId, pageNum, text) => invoke("save_page_text", { documentId: docId, pageNumber: pageNum, text }),
          (docId, pageNum) => invoke("mark_page_text_failed", { documentId: docId, pageNumber: pageNum }),
        );
        extractionRef.current = eq;
        eq.setCurrentPage(1, pdf.numPages);
        setTimeout(() => eq.enqueueAll(pdf.numPages), 2000);
      } catch (err) {
        if (!destroyed) setError(`Failed to load PDF: ${err}`);
      }
    };
    loadPdf();
    return () => {
      destroyed = true;
      extractionRef.current?.destroy();
      pdfRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Update extraction priority when visible range changes
  useEffect(() => {
    if (extractionRef.current && pageCount > 0) {
      extractionRef.current.setCurrentPage(currentPage, pageCount);
    }
  }, [currentPage, pageCount]);

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

  // Open another PDF
  const handleOpenPdf = useDocumentStore((s) => s.handleOpenPdf);

  // Handle Explain action
  const handleExplain = useCallback(async () => {
    if (!currentDocument || !selectionText) return;
    clearSelection();
    await runWorkflow({
      documentId: currentDocument.id,
      documentTitle: currentDocument.title ?? undefined,
      mode: "selection_explain",
      pageNumber: currentPage,
      selectedText: selectionText,
    });
  }, [currentDocument, selectionText, currentPage, runWorkflow, clearSelection]);

  // Scroll to page (used by keyboard nav)
  const goToPage = useCallback(
    (page: number) => {
      const pdf = pdfRef.current;
      if (!pdf) return;
      const p = Math.max(1, Math.min(pdf.numPages, page));
      if (p !== currentPage) {
        scrollToPage(p);
        clearSelection();
        invoke("update_last_page", { documentId, pageNumber: p }).catch(() => {});
      }
    },
    [currentPage, documentId, scrollToPage, clearSelection],
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
      // Let system shortcuts (Cmd+C/V/A, etc.) pass through
      if (e.metaKey || e.ctrlKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goToPage(currentPage - 1); }
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goToPage(currentPage + 1); }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); handleSetZoom(zoom + 0.25); }
      if (e.key === "-") { e.preventDefault(); handleSetZoom(zoom - 0.25); }
      if (e.key === "0") { e.preventDefault(); handleSetZoom(1.0); }
      if ((e.key === "e" || e.key === "E") && selectionText) {
        e.preventDefault();
        handleExplain();
      }
      if (e.key === "Escape") { clearSelection(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentPage, zoom, goToPage, handleSetZoom, clearSelection, selectionText, handleExplain]);

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

  // Search across all pages via pdfjs text content
  const performSearch = useCallback(async (query: string) => {
    const pdf = pdfRef.current;
    if (!pdf || !query.trim()) { setSearchResults([]); return; }
    searchCancelledRef.current = false;
    setIsSearching(true);
    const results: Array<{ pageNum: number; context: string }> = [];
    const q = query.toLowerCase();

    for (let i = 1; i <= pdf.numPages; i++) {
      if (searchCancelledRef.current) break;
      try {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const text = tc.items.map((item: any) => item.str).join(" ");
        page.cleanup();

        let pos = text.toLowerCase().indexOf(q);
        while (pos >= 0) {
          const start = Math.max(0, pos - 40);
          const end = Math.min(text.length, pos + q.length + 40);
          const snippet = (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
          results.push({ pageNum: i, context: snippet });
          pos = text.toLowerCase().indexOf(q, pos + 1);
        }
      } catch { /* skip unrenderable pages */ }
      // Yield every 3 pages to keep UI responsive for long PDFs
      if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    if (!searchCancelledRef.current) {
      setSearchResults(results);
      setCurrentResultIdx(0);
      if (results.length > 0) scrollToPage(results[0].pageNum);
    }
    setIsSearching(false);
  }, [scrollToPage]);

  // Cancel search on unmount
  useEffect(() => {
    return () => { searchCancelledRef.current = true; };
  }, []);

  const goToSearchResult = useCallback((idx: number) => {
    if (idx < 0 || idx >= searchResults.length) return;
    setCurrentResultIdx(idx);
    scrollToPage(searchResults[idx].pageNum);
  }, [searchResults, scrollToPage]);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
          background: "var(--bg-primary)", borderBottom: "1px solid var(--border-color)",
          fontSize: 13, flexShrink: 0,
        }}
      >
        <button onClick={() => { handleOpenPdf(); clearSelection(); }} title="Open PDF (Cmd+O)" style={{ fontWeight: 600 }}>
          📂 Open
        </button>
        <span style={{ color: "var(--border-color)" }}>|</span>
        <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>◀ Prev</button>
        <span>
          Page{" "}
          <input
            type="number" value={currentPage} min={1} max={pageCount || 1}
            onChange={(e) => goToPage(Number(e.target.value))}
            style={{ width: 50, textAlign: "center", padding: "2px 4px", border: "1px solid var(--border-color)", borderRadius: 3 }}
          />{" "}
          / {pageCount || "?"}
        </span>
        <button onClick={() => goToPage(currentPage + 1)} disabled={!pdfRef.current || currentPage >= pageCount}>Next ▶</button>
        <button onClick={handleToggleSearch} title="Search (Ctrl+F)" style={{ opacity: showSearch ? 1 : 0.6 }}>
          🔍
        </button>
        <button onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Toggle dark/light theme">
          {theme === "light" ? "🌙" : "☀️"}
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={() => handleSetZoom(zoom - 0.25)} disabled={zoom <= 0.25}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => handleSetZoom(zoom + 0.25)} disabled={zoom >= 4.0}>+</button>
        <button onClick={() => handleSetZoom(1.0)}>Reset</button>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
          padding: "4px 12px", borderBottom: "1px solid var(--border-color)",
          background: "var(--bg-primary)", fontSize: 13,
        }}>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") performSearch(searchQuery); }}
            placeholder="Search in document…"
            autoFocus
            style={{
              flex: 1, padding: "4px 8px", border: "1px solid var(--border-color)",
              borderRadius: 3, fontSize: 13, background: "var(--bg-primary)", color: "var(--text-primary)",
            }}
          />
          <button onClick={() => performSearch(searchQuery)} disabled={isSearching || !searchQuery.trim()}
            style={{ padding: "4px 10px", background: "var(--accent-color)", color: "#fff", border: "none", borderRadius: 3, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>
            {isSearching ? "…" : "Search"}
          </button>
          {!isSearching && searchResults.length > 0 && (
            <>
              <span style={{ color: "var(--text-secondary)", fontSize: 12, whiteSpace: "nowrap" }}>
                {currentResultIdx + 1} / {searchResults.length}
              </span>
              <button onClick={() => goToSearchResult(currentResultIdx - 1)} disabled={currentResultIdx <= 0}
                style={{ padding: "2px 6px", fontSize: 12, cursor: "pointer" }}>◀</button>
              <button onClick={() => goToSearchResult(currentResultIdx + 1)} disabled={currentResultIdx >= searchResults.length - 1}
                style={{ padding: "2px 6px", fontSize: 12, cursor: "pointer" }}>▶</button>
            </>
          )}
          {!isSearching && searchQuery && searchResults.length === 0 && (
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>No results</span>
          )}
          <button onClick={handleToggleSearch} style={{ padding: "2px 6px", fontSize: 12, cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* Scroll container */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          position: "relative",
          background: "var(--bg-tertiary)",
        }}
      >
        {error ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <p style={{ color: "var(--danger-color)", marginBottom: 8 }}>{error}</p>
          </div>
        ) : pageCount === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
            Loading PDF...
          </div>
        ) : (
          <div style={{ height: totalHeight, position: "relative", width: "100%" }}>
            {pageNumbers.map((pageNum) => {
              const idx = pageNum - 1;
              const top = idx > 0
                ? heights.slice(0, idx).reduce((a, b) => a + b, 0)
                : 0;
              return (
                <PageView
                  key={pageNum}
                  pageNum={pageNum}
                  pdf={pdfRef.current!}
                  zoom={zoom}
                  top={top}
                  width={pageWidthAtZoom}
                  height={pageHeightAtZoom}
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
          onExplain={handleExplain}
        />
      )}
    </div>
  );
}
