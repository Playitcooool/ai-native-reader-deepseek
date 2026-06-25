import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Annotation } from "../../stores/notesStore";
import { useUndoStore } from "../../stores/undoStore";
import {
  denormalizePoint,
  normalizePoint,
  parseInkAnchor,
  simplifyLocalPoints,
  strokeInsideLasso,
  type InkAnchor,
  type InkPoint,
  type InkSpace,
  type InkToolState,
} from "./inkGeometry";

interface InkCanvasOverlayProps {
  documentId: string;
  pageNumber: number;
  width: number;
  height: number;
  annotations: Annotation[];
  toolState: InkToolState;
  space: InkSpace;
  renderScale?: number;
  sectionIndex?: number;
  href?: string;
  onChanged?: () => void;
}

interface InkAnnotation {
  annotation: Annotation;
  anchor: InkAnchor;
}

export default function InkCanvasOverlay({
  documentId,
  pageNumber,
  width,
  height,
  annotations,
  toolState,
  space,
  renderScale = 1,
  sectionIndex,
  href,
  onChanged,
}: InkCanvasOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [draft, setDraft] = useState<InkPoint[]>([]);
  const pointerIdRef = useRef<number | null>(null);
  const pushUndo = useUndoStore((s) => s.pushUndo);
  const size = useMemo(() => ({ width, height }), [width, height]);

  const inks = useMemo<InkAnnotation[]>(() => {
    return annotations
      .filter((a) => a.type === "ink")
      .map((annotation) => {
        const anchor = parseInkAnchor(annotation.anchor_json);
        return anchor ? { annotation, anchor } : null;
      })
      .filter((item): item is InkAnnotation => Boolean(item));
  }, [annotations]);

  const active = toolState.activeTool !== "none";

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const { annotation, anchor } of inks) {
      renderStroke(ctx, anchor.points.map((p) => denormalizePoint(p, size)), annotation.color ?? "#111827", anchor.width * renderScale);
    }

    if (draft.length >= 2) {
      if (toolState.activeTool === "pen") {
        renderStroke(ctx, draft, toolState.color, toolState.penWidth);
      } else if (toolState.activeTool === "eraser") {
        ctx.save();
        ctx.strokeStyle = "rgba(220, 38, 38, 0.72)";
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(draft[0].x, draft[0].y);
        for (let i = 1; i < draft.length; i++) ctx.lineTo(draft[i].x, draft[i].y);
        if (draft.length >= 3) ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [draft, height, inks, renderScale, size, toolState.activeTool, toolState.color, toolState.penWidth, width]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    if (toolState.activeTool === "none") {
      pointerIdRef.current = null;
      setDraft([]);
    }
  }, [toolState.activeTool]);

  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>): InkPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
  };

  const commitPen = async (points: InkPoint[]) => {
    const normalized = simplifyLocalPoints(points).map((p) => normalizePoint(p, size));
    if (normalized.length < 2) return;
    const anchor: InkAnchor = {
      version: 1,
      space,
      points: normalized,
      width: Math.max(0.5, toolState.penWidth / renderScale),
      sectionIndex,
      href,
    };
    const annotation = await invoke<Annotation>("create_annotation", {
      input: {
        document_id: documentId,
        page_number: pageNumber,
        toc_node_id: null,
        type: "ink",
        selected_text: null,
        note_text: null,
        color: toolState.color,
        anchor: JSON.stringify(anchor),
      },
    });
    pushUndo({
      label: "ink",
      undo: async () => {
        await invoke("delete_annotation", { annotationId: annotation.id });
        window.dispatchEvent(new Event("annotations-changed"));
      },
    });
    onChanged?.();
    window.dispatchEvent(new Event("annotations-changed"));
  };

  const commitEraser = async (points: InkPoint[]) => {
    const eraserPath = simplifyLocalPoints(points, 1);
    if (eraserPath.length < 3) return;

    const affected = inks.filter(({ anchor }) => strokeInsideLasso(anchor, eraserPath, size));
    if (affected.length === 0) return;

    for (const item of affected) {
      await invoke("delete_annotation", { annotationId: item.annotation.id });
    }

    pushUndo({
      label: "erase ink",
      undo: async () => {
        for (const item of affected) {
          await invoke("create_annotation", {
            input: {
              document_id: documentId,
              page_number: pageNumber,
              toc_node_id: null,
              type: "ink",
              selected_text: null,
              note_text: null,
              color: item.annotation.color,
              anchor: JSON.stringify(item.anchor),
            },
          });
        }
        window.dispatchEvent(new Event("annotations-changed"));
      },
    });
    onChanged?.();
    window.dispatchEvent(new Event("annotations-changed"));
  };

  const finishGesture = async () => {
    const points = draft;
    pointerIdRef.current = null;
    setDraft([]);
    try {
      if (toolState.activeTool === "pen") await commitPen(points);
      if (toolState.activeTool === "eraser") await commitEraser(points);
    } catch {
      // The readers already refresh on successful writes; failed ink saves are non-fatal.
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className={`ink-overlay ${active ? "active" : ""}`}
      style={{
        position: "absolute",
        inset: 0,
        width,
        height,
        pointerEvents: active ? "auto" : "none",
        touchAction: active ? "none" : "auto",
        cursor: toolState.activeTool === "pen" ? "crosshair" : toolState.activeTool === "eraser" ? "cell" : "default",
      }}
      onPointerDown={(event) => {
        if (!active || pointerIdRef.current !== null) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointerIdRef.current = event.pointerId;
        setDraft([localPoint(event)]);
      }}
      onPointerMove={(event) => {
        if (!active || pointerIdRef.current !== event.pointerId) return;
        event.preventDefault();
        const point = localPoint(event);
        setDraft((points) => {
          const last = points[points.length - 1];
          if (last && Math.hypot(last.x - point.x, last.y - point.y) < 1) return points;
          return [...points, point];
        });
      }}
      onPointerUp={(event) => {
        if (pointerIdRef.current !== event.pointerId) return;
        event.preventDefault();
        event.currentTarget.releasePointerCapture(event.pointerId);
        void finishGesture();
      }}
      onPointerCancel={(event) => {
        if (pointerIdRef.current !== event.pointerId) return;
        pointerIdRef.current = null;
        setDraft([]);
      }}
    />
  );
}

function renderStroke(ctx: CanvasRenderingContext2D, points: InkPoint[], color: string, width: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, width);
  renderPath(ctx, points);
  ctx.restore();
}

function renderPath(ctx: CanvasRenderingContext2D, points: InkPoint[]) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
}
