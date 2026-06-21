import "./App.css";
import LeftSidebar from "./components/LeftSidebar";
import CenterViewer from "./components/CenterViewer";
import AiSidebar from "./components/AiSidebar";
import { useSettingsStore } from "./stores/settingsStore";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProviderSettings } from "./stores/settingsStore";

function App() {
  const setSettings = useSettingsStore((s) => s.setSettings);

  useEffect(() => {
    invoke<ProviderSettings[]>("get_provider_settings")
      .then((settings) => {
        if (settings && settings.length > 0) {
          setSettings(settings);
        }
      })
      .catch(console.error);
  }, [setSettings]);

  return (
    <div className="app-layout">
      <LeftSidebar />
      <CenterViewer />
      <AiSidebar />
    </div>
  );
}

export default App;
