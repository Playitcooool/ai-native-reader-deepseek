import { lazy, Suspense, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import "../pdfjs";
import { documentDisplayTitle, type Document, useDocumentStore } from "../stores/documentStore";
import PdfViewer from "./PdfViewer";
const EpubViewer = lazy(() => import("../features/epub/EpubViewer"));
import { useToast } from "./Toast";

function formatTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

const coverCache = new Map<string, string>();
// Concurrency pool — max 4 parallel cover renders
const MAX_RENDERS = 4;
let activeRenders = 0;
const renderQueue: (() => void)[] = [];
function scheduleCoverRender(fn: () => Promise<void>) {
  const run = () => {
    activeRenders++;
    fn().finally(() => {
      activeRenders--;
      const next = renderQueue.shift();
      if (next) next();
    });
  };
  if (activeRenders < MAX_RENDERS) {
    run();
  } else {
    renderQueue.push(run);
  }
}

export default function CenterViewer({
  onBackHome,
  onOpenLibrary,
  onOpenAi,
}: {
  onBackHome?: () => void;
  onOpenLibrary?: () => void;
  onOpenAi?: (draft?: string) => void;
}) {
  const { documents, currentDocument, handleOpenDocument, handleOpenFolder, setCurrentDocument, dailyStats, loadReadingStats } = useDocumentStore();
  const { addToast } = useToast();

  useEffect(() => {
    loadReadingStats();
  }, [loadReadingStats]);

  if (currentDocument) {
    return (
      <>
        <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
          {documentDisplayTitle(currentDocument)}
        </h1>
        {currentDocument.document_type === 'epub' ? (
          <Suspense fallback={<div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)" }}>Loading EPUB…</div>}>
            <EpubViewer
              key={currentDocument.id}
              documentId={currentDocument.id}
              onBackHome={onBackHome}
              onOpenLibrary={onOpenLibrary}
              onOpenAi={onOpenAi}
            />
          </Suspense>
        ) : (
          <PdfViewer
            key={currentDocument.id}
            documentId={currentDocument.id}
            onBackHome={onBackHome}
            onOpenLibrary={onOpenLibrary}
            onOpenAi={onOpenAi}
          />
        )}
      </>
    );
  }

  return (
    <div className="library-view">
      <div className="library-header">
        <div>
          <p className="library-eyebrow">RustyBooks</p>
          <h1>Library</h1>
          <p>{documents.length ? "Pick up where you left off." : "Add a document to begin."}</p>
        </div>
        <div className="library-actions">
          <button className="primary-action" onClick={() => handleOpenDocument().catch(() => addToast({ type: "error", message: "Failed to open document." }))}>
            Open Document
          </button>
          <button onClick={() => handleOpenFolder().catch(() => addToast({ type: "error", message: "Failed to open folder." }))}>
            Folder
          </button>
        </div>
      </div>

      {dailyStats && (dailyStats.todaySeconds > 0 || dailyStats.weekSeconds > 0) && (
        <div className="reading-stats">
          <span>📖 Today: {formatTime(dailyStats.todaySeconds)}</span>
          <span className="reading-stats-sep">•</span>
          <span>Week: {formatTime(dailyStats.weekSeconds)}</span>
        </div>
      )}

      <div className="book-grid">
        {documents.length === 0 ? (
          <div className="empty-state">
            <h2>No books yet</h2>
            <p>Use Open PDF or Import Folder to add your first document.</p>
          </div>
        ) : (
          documents.map((doc) => (
            <button key={doc.id} className="book-card" onClick={() => setCurrentDocument(doc)}>
              <BookCover doc={doc} />
              <span className="book-title">{documentDisplayTitle(doc)}</span>
              {doc.author && <span className="book-meta" style={{ color: "var(--text-muted)" }}>{doc.author}</span>}
              <span className="book-meta">
                {doc.document_type === 'epub'
                ? (doc.last_page ? `${doc.last_page}%` : doc.page_count ? `${doc.page_count} chapters` : "Ready")
                : (doc.last_page ? `Page ${doc.last_page}` : doc.page_count ? `${doc.page_count} pages` : "Ready")}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function BookCover({ doc }: { doc: Document }) {
  const [src, setSrc] = useState(() => coverCache.get(doc.id));

  useEffect(() => {
    let cancelled = false;
    const cached = coverCache.get(doc.id);
    if (cached) {
      setSrc(cached);
      return;
    }
    scheduleCoverRender(async () => {
      if (cancelled) return;
      const cover = await renderCover(doc.id, doc.document_type);
      if (cover && !cancelled) {
        coverCache.set(doc.id, cover);
        setSrc(cover);
      }
    });
    return () => { cancelled = true; };
  }, [doc.id]);

  return (
    <span className="book-cover" aria-hidden="true">
      {src ? <img src={src} alt="" /> : <span>{doc.document_type === 'epub' ? 'EPUB' : 'PDF'}</span>}
    </span>
  );
}

async function renderCover(documentId: string, docType: string): Promise<string | null> {
  // Check disk cache first
  try {
    const cached = await invoke<number[] | null>("get_cached_cover", { documentId });
    if (cached && cached.length > 0) {
      return URL.createObjectURL(new Blob([new Uint8Array(cached)]));
    }
  } catch { /* no cached cover */ }

  if (docType === 'epub') {
    try {
      const docs = useDocumentStore.getState().documents;
      const doc = docs.find(d => d.id === documentId);
      if (!doc) return null;
      const cover = await invoke<number[] | null>("get_document_cover", {
        documentId, filePath: doc.file_path, documentType: docType,
      });
      if (!cover) return null;
      return URL.createObjectURL(new Blob([new Uint8Array(cover)]));
    } catch { return null; }
  }

  // PDF: render via pdfjs, then cache to disk
  try {
    const data = await invoke<number[] | Uint8Array>("read_document_bytes", { documentId });
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
    try {
      const page = await pdf.getPage(1);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scale = 320 / viewport.width;
        const renderViewport = page.getViewport({ scale: scale * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
        const dataUrl = canvas.toDataURL("image/png");
        // Cache to disk for next app launch
        const base64 = dataUrl.split(",")[1];
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        invoke("cache_cover", { documentId, data: Array.from(bytes) }).catch(() => {});
        return dataUrl;
      } finally { page.cleanup(); }
    } finally { pdf.destroy(); }
  } catch { return null; }
}
