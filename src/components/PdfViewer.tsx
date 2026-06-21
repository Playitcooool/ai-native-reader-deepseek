import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import "../pdfjs";
import { useDocumentStore } from "../stores/documentStore";
import { useAiStore } from "../stores/aiStore";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { extractToc, type TocNodeInput } from "../features/toc/tocTree";
import { PageExtractionQueue } from "../features/pdf/pdfTextExtraction";
import PdfTextLayer from "../features/pdf/PdfTextLayer";
import SelectionMenu from "../features/pdf/SelectionMenu";

interface PdfViewerProps {
  filePath: string;
  documentId: string;
}

export default function PdfViewer({ filePath, documentId }: PdfViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageProxy, setPageProxy] = useState<PDFPageProxy | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<any>(null);
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
  const runWorkflow = useAiStore((s) => s.runWorkflow);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<any>(null);
  const extractionRef = useRef<PageExtractionQueue | null>(null);

  const renderPage = useCallback(
    async (pdf: PDFDocumentProxy, pageNum: number, scale: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      setError(null);
      setPageProxy(null);
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
      try {
        const page: PDFPageProxy = await pdf.getPage(pageNum);
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        const renderTask = page.render({
          canvasContext: ctx,
          viewport: page.getViewport({ scale }),
        });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        setPageProxy(page);
      } catch (err: any) {
        if (err?.name === "RenderingCancelledException") return;
        setError(`Failed to render page ${pageNum}`);
      }
    },
    [],
  );

  // Load PDF
  useEffect(() => {
    let destroyed = false;
    const loadPdf = async () => {
      try {
        // Read PDF via Rust command to avoid asset protocol issues
        const b64 = await invoke<string>("read_file_bytes", { filePath });
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (destroyed) { pdf.destroy(); return; }
        pdfRef.current = pdf;
        setTotalPages(pdf.numPages);
        invoke("update_page_count", { documentId, pageCount: pdf.numPages }).catch(() => {});

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
      renderTaskRef.current?.cancel();
      extractionRef.current?.destroy();
      pdfRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // Re-render
  useEffect(() => {
    const pdf = pdfRef.current;
    if (pdf && currentPage >= 1 && currentPage <= pdf.numPages) {
      renderPage(pdf, currentPage, zoom);
    }
  }, [currentPage, zoom, renderPage]);

  // Update extraction priority
  useEffect(() => {
    const pdf = pdfRef.current;
    if (extractionRef.current && pdf) {
      extractionRef.current.setCurrentPage(currentPage, pdf.numPages);
    }
  }, [currentPage]);

  // Active TOC node
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

  // Handle text selection
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
  const handleOpenPdf = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!selected) return;
      const doc = await invoke<import("../stores/documentStore").Document>("import_pdf", { filePath: selected });
      useDocumentStore.getState().setCurrentDocument(doc);
      const docs = await invoke<import("../stores/documentStore").Document[]>("get_documents");
      useDocumentStore.getState().setDocuments(docs);
      clearSelection();
    } catch (err) {
      console.error("Failed to open PDF:", err);
    }
  }, [clearSelection]);

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

  // Navigation
  const goToPage = useCallback(
    (page: number) => {
      const pdf = pdfRef.current;
      if (!pdf) return;
      const p = Math.max(1, Math.min(pdf.numPages, page));
      if (p !== currentPage) {
        setCurrentPage(p);
        clearSelection();
        invoke("update_last_page", { documentId, pageNumber: p }).catch(() => {});
      }
    },
    [currentPage, documentId, setCurrentPage, clearSelection],
  );

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
      // 'E' for Explain
      if ((e.key === "e" || e.key === "E") && selectionText) {
        e.preventDefault();
        handleExplain();
      }
      if (e.key === "Escape") { clearSelection(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentPage, zoom, goToPage, setZoom, clearSelection, selectionText, handleExplain]);

  // Debounced zoom persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      invoke("update_last_zoom", { documentId, zoom }).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [zoom, documentId]);

  const pageHeight = canvasRef.current?.height ?? 800;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
          background: "var(--bg-primary)", borderBottom: "1px solid var(--border-color)",
          fontSize: 13, flexShrink: 0,
        }}
      >
        <button onClick={handleOpenPdf} title="Open PDF (Cmd+O)" style={{ fontWeight: 600 }}>
          📂 Open
        </button>
        <span style={{ color: "var(--border-color)" }}>|</span>
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
        ref={viewerRef}
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
          <div style={{ position: "relative", minHeight: pageHeight, userSelect: "none" }}>
            <canvas
              ref={canvasRef}
              style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.15)", background: "#fff", display: "block" }}
            />
            {pageProxy && (
              <PdfTextLayer page={pageProxy} scale={zoom} onSelection={handleTextSelection} />
            )}
          </div>
        )}
      </div>

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
