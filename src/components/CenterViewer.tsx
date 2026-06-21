import { useDocumentStore } from "../stores/documentStore";
import PdfViewer from "./PdfViewer";

export default function CenterViewer() {
  const { currentDocument, handleOpenPdf } = useDocumentStore();

  if (currentDocument) {
    return (
      <PdfViewer
        filePath={currentDocument.file_path}
        documentId={currentDocument.id}
      />
    );
  }

  return (
    <div className="center-viewer">
      <div className="empty-state">
        <h2>AI-Native PDF Reader</h2>
        <p>Open a PDF to start reading with AI.</p>
        <button
          onClick={handleOpenPdf}
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
