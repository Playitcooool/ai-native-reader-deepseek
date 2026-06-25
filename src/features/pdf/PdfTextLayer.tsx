import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Util } from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export interface TextSpan {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface TextHighlight {
  selected_text: string | null;
  color: string | null;
  anchor_json?: string | null;
}

interface PdfTextLayerProps {
  page: PDFPageProxy;
  scale: number;
  onSelection: (text: string, anchor: { pageNumber: number; selectedText: string; prefix?: string; suffix?: string }) => void;
  containerWidth?: number;
  containerHeight?: number;
  highlights?: TextHighlight[];
}

export default memo(function PdfTextLayer({ page, scale, onSelection, containerWidth, containerHeight, highlights = [] }: PdfTextLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [spans, setSpans] = useState<TextSpan[]>([]);
  const spanHighlightColors = useMemo(() => getHighlightColors(spans, highlights), [spans, highlights]);

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
          .map((item) => buildTextSpan(item, viewport.transform, scale));
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
            top: s.y,
            display: "block",
            width: s.width,
            height: s.height,
            fontSize: s.fontSize,
            whiteSpace: "pre",
            lineHeight: 1,
            overflow: "hidden",
            background: spanHighlightColors[i],
          }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
});

export function buildTextSpan(item: TextItem, viewportTransform: number[], scale: number): TextSpan {
  const tx = Util.transform(viewportTransform, item.transform);
  const fontHeight = Math.hypot(tx[2], tx[3]) || (item.height || 12) * scale;
  const width = Math.max(item.width * scale, 0);
  return {
    text: item.str,
    x: tx[4],
    y: tx[5] - fontHeight,
    width,
    height: fontHeight,
    fontSize: fontHeight,
  };
}

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

export function getHighlightColors(spans: TextSpan[], highlights: TextHighlight[]): Array<string | undefined> {
  const ranges = spanRanges(spans);
  const colors = spans.map(() => undefined as string | undefined);
  for (const h of highlights) {
    const needle = compact(h.selected_text ?? "");
    if (!needle) continue;
    const start = findHighlightStart(ranges.fullText, needle, h.anchor_json);
    if (start === null) continue;
    const end = start + needle.length;
    ranges.forEach((range, index) => {
      if (range.start < end && start < range.end) colors[index] = translucent(h.color ?? "#fde047");
    });
  }
  return colors;
}

function spanRanges(spans: TextSpan[]): Array<{ start: number; end: number }> & { fullText: string } {
  let fullText = "";
  const ranges = spans.map((span) => {
    const start = fullText.length;
    fullText += compact(span.text);
    return { start, end: fullText.length };
  }) as Array<{ start: number; end: number }> & { fullText: string };
  ranges.fullText = fullText;
  return ranges;
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

function translucent(color: string): string {
  const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!hex) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.35)`;
}

function findHighlightStart(fullText: string, selectedText: string, anchorJson?: string | null): number | null {
  const anchor = parseAnchor(anchorJson);
  const prefix = compact(anchor?.prefix ?? "");
  const suffix = compact(anchor?.suffix ?? "");
  if (prefix || suffix) {
    const contextStart = fullText.indexOf(`${prefix}${selectedText}${suffix}`);
    if (contextStart >= 0) return contextStart + prefix.length;
  }
  const start = fullText.indexOf(selectedText);
  return start >= 0 ? start : null;
}

function parseAnchor(anchorJson?: string | null): { prefix?: string; suffix?: string } | null {
  if (!anchorJson) return null;
  try {
    return JSON.parse(anchorJson);
  } catch {
    return null;
  }
}
