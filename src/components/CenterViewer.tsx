import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import "../pdfjs";
import { documentDisplayTitle, type Document, useDocumentStore } from "../stores/documentStore";
import PdfViewer from "./PdfViewer";
import { useToast } from "./Toast";

const coverCache = new Map<string, string>();
let coverQueue = Promise.resolve();

export default function CenterViewer({
  onBackHome,
  onOpenLibrary,
  onOpenAi,
}: {
  onBackHome?: () => void;
  onOpenLibrary?: () => void;
  onOpenAi?: (draft?: string) => void;
}) {
  const { documents, currentDocument, handleOpenPdf, handleOpenFolder, setCurrentDocument } = useDocumentStore();
  const { addToast } = useToast();

  if (currentDocument) {
    return (
      <>
        <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
          {documentDisplayTitle(currentDocument)}
        </h1>
        <PdfViewer
          key={currentDocument.id}
          documentId={currentDocument.id}
          onBackHome={onBackHome}
          onOpenLibrary={onOpenLibrary}
          onOpenAi={onOpenAi}
        />
      </>
    );
  }

  return (
    <div className="library-view">
      <div className="library-header">
        <div>
          <p className="library-eyebrow">RustyBooks</p>
          <h1>Library</h1>
          <p>{documents.length ? "Pick up where you left off." : "Add a PDF to begin."}</p>
        </div>
        <div className="library-actions">
          <button className="primary-action" onClick={() => handleOpenPdf().catch(() => addToast({ type: "error", message: "Failed to open PDF." }))}>
            Open PDF
          </button>
          <button onClick={() => handleOpenFolder().catch(() => addToast({ type: "error", message: "Failed to open folder." }))}>
            Folder
          </button>
        </div>
      </div>

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
              <span className="book-meta">
                {doc.last_page ? `Page ${doc.last_page}` : doc.page_count ? `${doc.page_count} pages` : "Ready"}
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
    const timer = window.setTimeout(() => {
      coverQueue = coverQueue
        .then(() => renderCover(doc.id))
        .then((cover) => {
          if (!cover || cancelled) return;
          coverCache.set(doc.id, cover);
          setSrc(cover);
        })
        .catch(() => {});
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [doc.id]);

  return (
    <span className="book-cover" aria-hidden="true">
      {src ? <img src={src} alt="" /> : <span>PDF</span>}
    </span>
  );
}

async function renderCover(documentId: string): Promise<string | null> {
  const data = await invoke<number[] | Uint8Array>("read_document_pdf", { documentId });
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
      return canvas.toDataURL("image/png");
    } finally {
      page.cleanup();
    }
  } finally {
    pdf.destroy();
  }
}
