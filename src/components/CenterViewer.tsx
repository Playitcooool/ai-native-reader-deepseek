import { useDocumentStore } from "../stores/documentStore";
import PdfViewer from "./PdfViewer";
import { useToast } from "./Toast";

export default function CenterViewer({ onOpenAi }: { onOpenAi?: () => void }) {
  const { documents, currentDocument, handleOpenPdf, handleOpenFolder, setCurrentDocument } = useDocumentStore();
  const { addToast } = useToast();

  if (currentDocument) {
    return (
      <>
        <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
          {currentDocument.title ?? currentDocument.original_filename}
        </h1>
        <PdfViewer
          key={currentDocument.id}
          documentId={currentDocument.id}
          onOpenAi={onOpenAi}
        />
      </>
    );
  }

  return (
    <div className="library-view">
      <div className="library-header">
        <div>
          <p className="library-eyebrow">AI Reader</p>
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
              <span className="book-cover" aria-hidden="true">
                <span>PDF</span>
              </span>
              <span className="book-title">{doc.title ?? doc.original_filename}</span>
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
