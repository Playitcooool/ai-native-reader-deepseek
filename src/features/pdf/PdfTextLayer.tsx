import { memo, useEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

interface TextSpan {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

interface PdfTextLayerProps {
  page: PDFPageProxy;
  scale: number;
  onSelection: (text: string, anchor: { pageNumber: number; selectedText: string; prefix?: string; suffix?: string }) => void;
  containerWidth?: number;
  containerHeight?: number;
}

export default memo(function PdfTextLayer({ page, scale, onSelection, containerWidth, containerHeight }: PdfTextLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [spans, setSpans] = useState<TextSpan[]>([]);

  useEffect(() => {
    let cancelled = false;
    const buildLayer = async () => {
      try {
        const textContent = await page.getTextContent();
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const items = textContent.items as TextItem[];
        const textSpans: TextSpan[] = items
          .filter((item) => item.str?.trim().length > 0)
          .map((item) => {
            const tx = item.transform;
            return {
              text: item.str,
              x: tx[4] * scale,
              y: viewport.height - tx[5] * scale,
              width: item.width * scale,
              height: (item.height || 12) * scale,
              fontSize: (item.height || 12) * scale,
            };
          });
        if (!cancelled) setSpans(textSpans);
      } catch (err) {
        console.warn("Failed to build text layer:", err);
      }
    };
    buildLayer();
    return () => { cancelled = true; };
  }, [page, scale]);

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

    const text = sel.toString().trim();
    if (!text || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    const prefix = getContextText(range, 'before');
    const suffix = getContextText(range, 'after');
    const anchor = {
      pageNumber: page.pageNumber,
      selectedText: text,
      prefix: prefix || undefined,
      suffix: suffix || undefined,
    };

    // Defer state update so browser finishes native selection processing
    // before React re-renders and the SelectionMenu mounts/focuses.
    requestAnimationFrame(() => {
      onSelection(text, anchor);
    });
  };

  return (
    <div
      ref={layerRef}
      onMouseUp={handleMouseUp}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: containerWidth ?? "100%",
        height: containerHeight ?? "100%",
        color: "transparent",
        overflow: "hidden",
        lineHeight: 1,
      }}
    >
      {spans.map((s, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: s.x,
            top: s.y - s.height,
            fontSize: s.fontSize,
            whiteSpace: "pre",
            lineHeight: 1,
          }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
});

function getContextText(range: Range, dir: 'before' | 'after'): string {
  try {
    if (dir === 'before') {
      const clone = range.cloneRange();
      clone.collapse(true);
      clone.setStart(clone.startContainer, 0);
      return clone.toString().slice(-80).trim();
    } else {
      const clone = range.cloneRange();
      clone.collapse(false);
      const end = clone.endContainer;
      if (end.textContent) {
        clone.setEnd(end, end.textContent.length);
      }
      return clone.toString().slice(0, 80).trim();
    }
  } catch {
    return "";
  }
}
