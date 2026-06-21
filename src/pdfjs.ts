import { GlobalWorkerOptions } from "pdfjs-dist";

// Phase 0: Configure PDF.js worker before any PDF load.
// Uses the bundled worker file, not inline fallback.
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
