import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { convertFileSrc } from "@tauri-apps/api/core";
import "../pdfjs";
import { useDocumentStore } from "../stores/documentStore";
import { invoke } from "@tauri-apps/api/core";
import { extractToc, type TocNodeInput } from "../features/toc/tocTree";
import { PageExtractionQueue } from "../features/pdf/pdfTextExtraction";

interface PdfViewerProps {
  filePath: string;
  documentId: string;
}

export default function PdfViewer({ filePath, documentId }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    currentPage,
    zoom,
    setCurrentPage,
    setTotalPages,
    setZoom,
    setActiveTocNodeId,
    tocNodes,
    loadToc,
  } = useDocumentStore();
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<any>(null);
  const extractionRef = useRef<PageExtractionQueue | null>(null);

  const renderPage = useCallback(
    async (pdf: PDFDocumentProxy, pageNum: number, scale: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      setError(null);
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
      try {
        const page: PDFPageProxy = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const renderTask = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err: any) {
        if (err?.name === "RenderingCancelledException") return;
        setError(`Failed to render page ${pageNum}`);
      }
    },
    [],
  );

  // Load PDF, extract TOC, start text extraction
  useEffect(() => {
    let destroyed = false;
    const loadPdf = async () => {
      try {
        const url = convertFileSrc(filePath);
        const pdf = await pdfjsLib.getDocument(url).promise;
        if (destroyed) { pdf.destroy(); return; }
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
        invoke("update_page_count", { documentId, pageCount: pdf.numPages }).catch(() => {});

        // Extract TOC
        const tocInput = await extractToc(pdf, pdf.numPages);
        if (destroyed) return;
        if (tocInput.length > 0) {
          await invoke<TocNodeInput[]>("save_toc_nodes", {
            documentId,
            nodes: tocInput,
          });
        }
        await loadToc(documentId);

        // Start text extraction
        const eq = new PageExtractionQueue(
          pdf,
          documentId,
          (docId, pageNum, text) => invoke("save_page_text", { documentId: docId, pageNumber: pageNum, text }),
          (docId, pageNum) => invoke("mark_page_text_failed", { documentId: docId, pageNumber: pageNum }),
        );
        extractionRef.current = eq;
        eq.setCurrentPage(1, pdf.numPages);
        // Enqueue remaining pages at low priority after a short delay
        setTimeout(() => eq.enqueueAll(pdf.numPages), 2000);
      } catch (err) {
        if (!destroyed) setError(`Failed to load PDF: ${err}`);
      }
    };
    loadPdf();
    return () => {
      destroyed = true;
      renderTaskRef.current?.cancel();
      extractionRef.current?.destroy();
      pdfRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Re-render on page/zoom change
  useEffect(() => {
    const pdf = pdfRef.current;
    if (pdf && currentPage >= 1 && currentPage <= pdf.numPages) {
      renderPage(pdf, currentPage, zoom);
    }
  }, [currentPage, zoom, renderPage]);

  // Update extraction priority when page changes
  useEffect(() => {
    const pdf = pdfRef.current;
    if (extractionRef.current && pdf) {
      extractionRef.current.setCurrentPage(currentPage, pdf.numPages);
    }
  }, [currentPage]);

  // Track active TOC node
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

  // Navigation
  const goToPage = useCallback(
    (page: number) => {
      const pdf = pdfRef.current;
      if (!pdf) return;
      const p = Math.max(1, Math.min(pdf.numPages, page));
      if (p !== currentPage) {
        setCurrentPage(p);
        invoke("update_last_page", { documentId, pageNumber: p }).catch(() => {});
      }
    },
    [currentPage, documentId, setCurrentPage],
  );

  // Mouse wheel
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.deltaY > 0) goToPage(currentPage + 1);
      else goToPage(currentPage - 1);
    },
    [currentPage, goToPage],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); goToPage(currentPage - 1); }
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); goToPage(currentPage + 1); }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(zoom + 0.25); }
      if (e.key === "-") { e.preventDefault(); setZoom(zoom - 0.25); }
      if (e.key === "0") { e.preventDefault(); setZoom(1.0); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentPage, zoom, goToPage, setZoom]);

  // Debounced zoom persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      invoke("update_last_zoom", { documentId, zoom }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [zoom, documentId]);

  const scrollHeight = Math.max(canvasRef.current?.height ?? 800, 600);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
          background: "var(--bg-primary)", borderBottom: "1px solid var(--border-color)",
          fontSize: 13, flexShrink: 0,
        }}
      >
        <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>◀ Prev</button>
        <span>
          Page{" "}
          <input
            type="number" value={currentPage} min={1} max={pdfRef.current?.numPages ?? 1}
            onChange={(e) => goToPage(Number(e.target.value))}
            style={{ width: 50, textAlign: "center", padding: "2px 4px", border: "1px solid var(--border-color)", borderRadius: 3 }}
          />{" "}
          / {pdfRef.current?.numPages ?? "?"}
        </span>
        <button onClick={() => goToPage(currentPage + 1)} disabled={!pdfRef.current || currentPage >= pdfRef.current.numPages}>Next ▶</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => setZoom(zoom - 0.25)} disabled={zoom <= 0.25}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(zoom + 0.25)} disabled={zoom >= 4.0}>+</button>
        <button onClick={() => setZoom(1.0)}>Reset</button>
      </div>

      <div
        ref={containerRef}
        onWheel={handleWheel}
        style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          overflow: "auto", padding: 16, position: "relative",
        }}
      >
        {error ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <p style={{ color: "var(--danger-color)", marginBottom: 8 }}>{error}</p>
          </div>
        ) : (
          <div style={{ minHeight: scrollHeight, display: "flex", alignItems: "flex-start" }}>
            <canvas
              ref={canvasRef}
              style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.15)", background: "#fff" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
