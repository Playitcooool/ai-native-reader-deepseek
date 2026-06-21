import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, type ProviderSettingsInput } from "../stores/settingsStore";

export default function SettingsPanel() {
  const { settings, addSetting } = useSettingsStore();
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [providerType, setProviderType] = useState("openai_compatible");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const input: ProviderSettingsInput = {
        provider_type: providerType,
        base_url: baseUrl,
        api_key: apiKey || undefined,
        model,
        is_default: settings.length === 0,
      };
      const result = await invoke<{
        id: string;
        provider_type: string;
        base_url: string | null;
        api_key: string | null;
        model: string;
        is_default: boolean | null;
        created_at: string;
        updated_at: string;
      }>("save_provider_settings", { input });
      addSetting(result);
      setTestResult("Settings saved.");
    } catch (err) {
      setTestResult(`Error: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600 }}>AI Provider</h3>

      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        Provider Type
      </label>
      <select
        value={providerType}
        onChange={(e) => setProviderType(e.target.value)}
        style={{
          padding: "6px 8px",
          border: "1px solid var(--border-color)",
          borderRadius: 4,
          fontSize: 13,
          background: "var(--bg-primary)",
        }}
      >
        <option value="openai_compatible">OpenAI Compatible</option>
        <option value="lm_studio">LM Studio</option>
        <option value="ollama">Ollama</option>
      </select>

      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        Base URL
      </label>
      <input
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="https://api.openai.com/v1"
        style={{
          padding: "6px 8px",
          border: "1px solid var(--border-color)",
          borderRadius: 4,
          fontSize: 13,
        }}
      />

      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        API Key
      </label>
      <input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="sk-..."
        style={{
          padding: "6px 8px",
          border: "1px solid var(--border-color)",
          borderRadius: 4,
          fontSize: 13,
        }}
      />

      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        Model
      </label>
      <input
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="gpt-4o-mini"
        style={{
          padding: "6px 8px",
          border: "1px solid var(--border-color)",
          borderRadius: 4,
          fontSize: 13,
        }}
      />

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          padding: "8px 16px",
          background: "var(--accent-color)",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          fontSize: 13,
          fontWeight: 500,
          marginTop: 4,
        }}
      >
        {saving ? "Saving..." : "Save Settings"}
      </button>

      {testResult && (
        <p
          style={{
            fontSize: 12,
            color: testResult.startsWith("Error")
              ? "var(--danger-color)"
              : "var(--success-color)",
          }}
        >
          {testResult}
        </p>
      )}

      {settings.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Saved Providers
          </p>
          {settings.map((s) => (
            <div
              key={s.id}
              style={{
                fontSize: 12,
                padding: "6px 8px",
                background: "var(--bg-tertiary)",
                borderRadius: 4,
                marginBottom: 4,
              }}
            >
              {s.model} @ {s.base_url ?? "N/A"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
