import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import PdfTextLayer from "./PdfTextLayer";

interface PageViewProps {
  pageNum: number;
  pdf: PDFDocumentProxy;
  zoom: number;
  top: number;
  width: number;
  height: number;
  onSelection: (text: string, anchor: {
    pageNumber: number;
    selectedText: string;
    prefix?: string;
    suffix?: string;
  }) => void;
}

type Phase = "loading" | "ready" | "error";

/**
 * Renders one PDF page onto a canvas, with:
 *  - Double-buffered zoom transitions (CSS scale → re-render → cross-fade)
 *  - Loading skeleton placeholder
 *  - Error overlay on render failure
 *  - PdfTextLayer overlay for text selection
 */
export default function PageView({
  pageNum,
  pdf,
  zoom,
  top,
  width,
  height,
  onSelection,
}: PageViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const pageProxyRef = useRef<PDFPageProxy | null>(null);
  const renderTaskRef = useRef<any>(null);
  const genRef = useRef(0);
  const mountedRef = useRef(true);
  const prevZoomRef = useRef(zoom);
  const [phase, setPhase] = useState<Phase>("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Render into a specific canvas, returns the canvas on success
  const renderInto = useCallback(
    async (canvas: HTMLCanvasElement | null, targetZoom: number, gen: number): Promise<HTMLCanvasElement | null> => {
      if (!canvas || !pageProxyRef.current) return null;
      const page = pageProxyRef.current;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: targetZoom * dpr });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;

      try {
        await task.promise;
        renderTaskRef.current = null;
        return genRef.current === gen && mountedRef.current ? canvas : null;
      } catch (err: any) {
        if (err?.name === "RenderingCancelledException") return null;
        if (!mountedRef.current) return null;
        throw err;
      }
    },
    [],
  );

  // Load page proxy + initial render
  useEffect(() => {
    let dead = false;
    genRef.current++;
    setPhase("loading");
    setErrMsg(null);

    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (dead || !mountedRef.current) { page.cleanup(); return; }
        pageProxyRef.current = page;
        const gen = genRef.current;
        const ok = await renderInto(frontRef.current, zoom, gen);
        if (!dead && mountedRef.current && ok && genRef.current === gen) {
          setPhase("ready");
        }
      } catch (err: any) {
        if (dead || !mountedRef.current) return;
        setErrMsg(`Page ${pageNum}: ${err.message ?? err}`);
        setPhase("error");
      }
    })();

    return () => {
      dead = true;
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
      if (pageProxyRef.current) {
        pageProxyRef.current.cleanup();
        pageProxyRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, pdf]);

  // Zoom transition: CSS scale → re-render into back canvas → cross-fade
  useEffect(() => {
    if (prevZoomRef.current === zoom || phase !== "ready") {
      prevZoomRef.current = zoom;
      return;
    }
    const oldZoom = prevZoomRef.current;
    prevZoomRef.current = zoom;
    const wrapper = wrapperRef.current;
    const front = frontRef.current;
    const back = backRef.current;
    if (!wrapper || !front || !back) return;

    const gen = ++genRef.current;
    const ratio = zoom / oldZoom;

    // Hide text layer during transform
    const textEl = wrapper.querySelector<HTMLElement>("[data-text-layer]");
    if (textEl) textEl.style.display = "none";

    // Apply CSS scale for instant GPU-composited zoom feedback
    wrapper.style.transform = `scale(${ratio})`;
    wrapper.style.transformOrigin = "top left";
    wrapper.style.willChange = "transform";

    // Render into back canvas at new zoom
    renderInto(back, zoom, gen).then((newCanvas) => {
      if (!newCanvas || !mountedRef.current || genRef.current !== gen) {
        back.removeAttribute("style");
        return;
      }

      // Cross-fade: front out, back in
      front.style.transition = "opacity 0.15s ease";
      front.style.opacity = "0";
      back.style.transition = "opacity 0.15s ease";
      back.style.opacity = "1";

      // Remove CSS transform (new canvas is native-size at new zoom)
      wrapper.style.transform = "";
      wrapper.style.willChange = "";

      // Restore text layer
      if (textEl) {
        textEl.style.display = "";
        textEl.style.opacity = "0";
        requestAnimationFrame(() => {
          if (textEl) {
            textEl.style.transition = "opacity 0.15s ease";
            textEl.style.opacity = "1";
          }
        });
      }

      // After transition, swap canvas roles
      setTimeout(() => {
        // Move "back" canvas before "front" in DOM so PdfTextLayer sits on top
        if (back.parentNode && front.parentNode) {
          back.style.pointerEvents = "auto";
          front.style.pointerEvents = "none";
        }
      }, 150);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Swap refs after cross-fade so the freshly-rendered canvas becomes the front
  // We do this by swapping the actual ref values when front finishes fading out
  useEffect(() => {
    if (phase !== "ready") return;
    // After mount / re-render, ensure front canvas is visible, back is hidden
    const front = frontRef.current;
    const back = backRef.current;
    if (front) {
      front.style.opacity = "1";
      front.style.transition = "opacity 0.15s ease";
    }
    if (back) {
      back.style.opacity = "0";
      back.style.transition = "";
      back.style.pointerEvents = "none";
    }
  }, [phase]);

  const handleSelection = useCallback(
    (text: string, anchor: any) => onSelection(text, anchor),
    [onSelection],
  );

  return (
    <div
      ref={wrapperRef}
      style={{
        position: "absolute",
        top,
        left: "50%",
        transform: "translateX(-50%)",
        width,
        minHeight: height,
      }}
    >
      {/* Loading skeleton */}
      {phase === "loading" && (
        <div
          style={{
            height,
            background: "var(--bg-tertiary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
          }}
        >
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Page {pageNum}</span>
        </div>
      )}

      {/* Error overlay */}
      {phase === "error" && (
        <div
          style={{
            height,
            background: "var(--bg-secondary)",
            border: "1px solid var(--danger-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            padding: 16,
          }}
        >
          <span style={{ color: "var(--danger-color)", fontSize: 13 }}>{errMsg}</span>
        </div>
      )}

      {/* Front canvas (always visible in ready state) */}
      <canvas
        ref={frontRef}
        style={{
          display: phase === "ready" ? "block" : "none",
          boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
          background: "var(--bg-primary)",
          width: "100%",
        }}
      />

      {/* Back canvas (used during zoom transitions) */}
      <canvas
        ref={backRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          opacity: 0,
          pointerEvents: "none",
        }}
      />

      {/* Text selection layer */}
      {pageProxyRef.current && phase === "ready" && (
        <div
          data-text-layer
          style={{ opacity: 0, transition: "opacity 0.15s ease" }}
          ref={(el) => {
            if (el) requestAnimationFrame(() => { el.style.opacity = "1"; });
          }}
        >
          <PdfTextLayer
            page={pageProxyRef.current}
            scale={zoom}
            onSelection={handleSelection}
            containerWidth={width}
            containerHeight={height}
          />
        </div>
      )}
    </div>
  );
}
