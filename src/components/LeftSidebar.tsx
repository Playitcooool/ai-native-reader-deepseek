import { useState } from "react";
import SettingsPanel from "./SettingsPanel";

type Tab = "toc" | "notes" | "settings";

export default function LeftSidebar() {
  const [activeTab, setActiveTab] = useState<Tab>("toc");

  return (
    <div className="sidebar-left">
      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === "toc" ? "active" : ""}`}
          onClick={() => setActiveTab("toc")}
        >
          TOC
        </button>
        <button
          className={`tab-btn ${activeTab === "notes" ? "active" : ""}`}
          onClick={() => setActiveTab("notes")}
        >
          Notes
        </button>
        <button
          className={`tab-btn ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          Settings
        </button>
      </div>
      <div className="tab-content">
        {activeTab === "toc" && (
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            No PDF open. Open a PDF to see its table of contents.
          </p>
        )}
        {activeTab === "notes" && (
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            No notes yet. Save AI answers to see them here.
          </p>
        )}
        {activeTab === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}
