import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, type ProviderSettingsInput } from "../stores/settingsStore";

export default function SettingsPanel() {
  const { settings, addSetting } = useSettingsStore();
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [providerType, setProviderType] = useState("openai_compatible");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const input: ProviderSettingsInput = {
        provider_type: providerType,
        base_url: baseUrl,
        api_key: apiKey || undefined,
        model,
        is_default: settings.length === 0,
      };
      const result = await invoke<{
        id: string; provider_type: string; base_url: string | null;
        api_key: string | null; model: string; is_default: boolean | null;
        created_at: string; updated_at: string;
      }>("save_provider_settings", { input });
      addSetting(result);
      setStatus({ ok: true, msg: "Settings saved." });
    } catch (err) {
      setStatus({ ok: false, msg: `Error: ${err}` });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (providerId: string) => {
    setTesting(true);
    setStatus(null);
    try {
      const result = await invoke<{
        ok: boolean; model: string | null; latency_ms: number | null;
        error_code: string | null; error_message: string | null;
      }>("test_provider", { providerId });
      if (result.ok) {
        setStatus({ ok: true, msg: `Connected! Model: ${result.model ?? "unknown"} (${result.latency_ms ?? 0}ms)` });
      } else {
        setStatus({ ok: false, msg: `Error [${result.error_code ?? "unknown"}]: ${result.error_message ?? "No details"}` });
      }
    } catch (err) {
      setStatus({ ok: false, msg: `Error: ${err}` });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600 }}>AI Provider</h3>

      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Provider Type</label>
      <select
        value={providerType}
        onChange={(e) => setProviderType(e.target.value)}
        style={{ padding: "6px 8px", border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13, background: "var(--bg-primary)" }}
      >
        <option value="openai_compatible">OpenAI Compatible</option>
        <option value="lm_studio">LM Studio</option>
        <option value="ollama">Ollama</option>
      </select>

      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Base URL</label>
      <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1"
        style={{ padding: "6px 8px", border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13 }} />

      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>API Key</label>
      <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..."
        style={{ padding: "6px 8px", border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13 }} />

      <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Model</label>
      <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini"
        style={{ padding: "6px 8px", border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13 }} />

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSave} disabled={saving}
          style={{ flex: 1, padding: "8px 16px", background: "var(--accent-color)", color: "#fff", border: "none", borderRadius: 4, fontSize: 13, fontWeight: 500 }}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {status && (
        <p style={{ fontSize: 12, color: status.ok ? "var(--success-color)" : "var(--danger-color)" }}>
          {status.msg}
        </p>
      )}

      {settings.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Saved Providers</p>
          {settings.map((s) => (
            <div key={s.id} style={{ fontSize: 12, padding: "8px", background: "var(--bg-tertiary)", borderRadius: 4, marginBottom: 4 }}>
              <div style={{ fontWeight: 500 }}>{s.model}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.base_url ?? "N/A"}</div>
              <button onClick={() => handleTest(s.id)} disabled={testing}
                style={{ marginTop: 4, padding: "3px 8px", background: "transparent", color: "var(--accent-color)", border: "1px solid var(--accent-color)", borderRadius: 3, fontSize: 11, cursor: "pointer" }}>
                {testing ? "Testing..." : "Test Connection"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
