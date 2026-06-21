import "./App.css";
import LeftSidebar from "./components/LeftSidebar";
import CenterViewer from "./components/CenterViewer";
import AiSidebar from "./components/AiSidebar";
import { useSettingsStore } from "./stores/settingsStore";
import { useDocumentStore, type Document } from "./stores/documentStore";
import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { ProviderSettings } from "./stores/settingsStore";

function App() {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const { setCurrentDocument, setDocuments } = useDocumentStore();

  const handleOpenPdf = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!selected) return;
      const doc = await invoke<Document>("import_pdf", { filePath: selected });
      setCurrentDocument(doc);
      const docs = await invoke<Document[]>("get_documents");
      setDocuments(docs);
    } catch (err) {
      console.error("Failed to open PDF:", err);
    }
  }, [setCurrentDocument, setDocuments]);

  useEffect(() => {
    invoke<ProviderSettings[]>("get_provider_settings")
      .then((settings) => {
        if (settings && settings.length > 0) {
          setSettings(settings);
        }
      })
      .catch(console.error);
  }, [setSettings]);

  // Listen for native menu File > Open PDF (Cmd+O)
  useEffect(() => {
    const unlisten = listen("menu-open-pdf", () => {
      handleOpenPdf();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleOpenPdf]);

  return (
    <div className="app-layout">
      <LeftSidebar />
      <CenterViewer />
      <AiSidebar />
    </div>
  );
}

export default App;
