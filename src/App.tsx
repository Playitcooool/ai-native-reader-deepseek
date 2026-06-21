import "./App.css";
import LeftSidebar from "./components/LeftSidebar";
import CenterViewer from "./components/CenterViewer";
import AiSidebar from "./components/AiSidebar";
import { useSettingsStore } from "./stores/settingsStore";
import { useDocumentStore } from "./stores/documentStore";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProviderSettings } from "./stores/settingsStore";

function App() {
  const setSettings = useSettingsStore((s) => s.setSettings);
  const handleOpenPdf = useDocumentStore((s) => s.handleOpenPdf);

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
