import { useDocumentStore } from "../stores/documentStore";
import PdfViewer from "./PdfViewer";
import { useToast } from "./Toast";

export default function CenterViewer() {
  const { currentDocument, handleOpenPdf } = useDocumentStore();
  const { addToast } = useToast();

  if (currentDocument) {
    return (
      <>
        <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
          {currentDocument.title ?? currentDocument.original_filename}
        </h1>
        <PdfViewer
          key={currentDocument.id}
          filePath={currentDocument.file_path}
          documentId={currentDocument.id}
        />
      </>
    );
  }

  return (
    <div className="center-viewer">
      <div className="empty-state">
        <h1 style={{ fontSize: "inherit", fontWeight: "inherit", margin: 0 }}>AI-Native PDF Reader</h1>
        <p>Open a PDF to start reading with AI.</p>
        <button
          onClick={() => handleOpenPdf().catch(() => addToast({ type: "error", message: "Failed to open PDF." }))}
          style={{
            marginTop: 16,
            padding: "10px 24px",
            background: "var(--accent-color)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Open PDF
        </button>
      </div>
    </div>
  );
}
