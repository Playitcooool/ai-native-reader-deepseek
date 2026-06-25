import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, type ProviderSettingsInput } from "../stores/settingsStore";

export default function SettingsPanel() {
  const { settings, addSetting, updateSetting } = useSettingsStore();
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [providerType, setProviderType] = useState("openai_compatible");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [isTranslation, setIsTranslation] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const initialLoadDone = useRef(false);

  // Populate form from saved settings — only from blank state, never after save
  useEffect(() => {
    if (settings.length > 0 && !initialLoadDone.current) {
      initialLoadDone.current = true;
      const s = settings[0];
      setBaseUrl(s.base_url ?? "");
      setApiKey(s.api_key ?? "");
      setModel(s.model);
      setProviderType(s.provider_type);
      setEditingId(s.id);
      setIsDefault(s.is_default ?? true);
      setIsTranslation(s.is_translation ?? false);
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const input: ProviderSettingsInput = {
        id: editingId ?? undefined,
        provider_type: providerType,
        base_url: baseUrl || undefined,
        api_key: apiKey || undefined,
        model,
        is_default: isDefault,
        is_translation: isTranslation,
      };
      const result = await invoke<{
        id: string; provider_type: string; base_url: string | null;
        api_key: string | null; model: string; is_default: boolean | null; is_translation: boolean | null;
        created_at: string; updated_at: string;
      }>("save_provider_settings", { input });

      if (editingId) {
        updateSetting(editingId, result);
      } else {
        addSetting(result);
      }
      setEditingId(result.id);
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

  const selectProvider = (id: string) => {
    const s = settings.find((p) => p.id === id);
    if (!s) return;
    setBaseUrl(s.base_url ?? "");
    setApiKey(s.api_key ?? "");
    setModel(s.model);
    setProviderType(s.provider_type);
    setEditingId(s.id);
    setIsDefault(s.is_default ?? true);
    setIsTranslation(s.is_translation ?? false);
    setStatus(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600 }}>AI Provider</h3>

      <label htmlFor="provider-type" style={{ fontSize: 12, color: "var(--text-secondary)" }}>Provider Type</label>
      <select id="provider-type"
        value={providerType}
        onChange={(e) => setProviderType(e.target.value)}
        style={{ padding: "6px 8px", border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13, background: "var(--bg-primary)" }}
      >
        <option value="openai_compatible">OpenAI Compatible</option>
        <option value="lm_studio">LM Studio</option>
        <option value="ollama">Ollama</option>
      </select>

      <label htmlFor="base-url" style={{ fontSize: 12, color: "var(--text-secondary)" }}>Base URL</label>
      <input id="base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1"
        style={{ padding: "6px 8px", border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13, background: "var(--bg-primary)", color: "var(--text-primary)" }} />

      <label htmlFor="api-key" style={{ fontSize: 12, color: "var(--text-secondary)" }}>API Key</label>
      <input id="api-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..."
        style={{ padding: "6px 8px", border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13, background: "var(--bg-primary)", color: "var(--text-primary)" }} />

      <label htmlFor="model" style={{ fontSize: 12, color: "var(--text-secondary)" }}>Model</label>
      <input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini"
        style={{ padding: "6px 8px", border: "1px solid var(--border-color)", borderRadius: 4, fontSize: 13, background: "var(--bg-primary)", color: "var(--text-primary)" }} />

      <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", cursor: "pointer" }}>
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        Use as default provider (for Explain, Summarize, Q&A)
      </label>

      <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", cursor: "pointer" }}>
        <input type="checkbox" checked={isTranslation} onChange={(e) => setIsTranslation(e.target.checked)} />
        Use as translation provider
      </label>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleSave} disabled={saving} title="Save"
          style={{ padding: "6px 12px", background: "var(--accent-color)", color: "#fff", border: "none", borderRadius: 4, fontSize: 15, lineHeight: 1, cursor: "pointer" }}>
          {saving ? "⏳" : "💾"}
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
            <div
              key={s.id}
              onClick={() => selectProvider(s.id)}
              style={{
                fontSize: 12, padding: "8px", background: editingId === s.id ? "var(--accent-color)" : "var(--bg-tertiary)",
                borderRadius: 4, marginBottom: 4, cursor: "pointer",
                color: editingId === s.id ? "#fff" : "inherit",
              }}
            >
              <div style={{ fontWeight: 500 }}>{s.model}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>{s.base_url ?? "N/A"}</div>
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                {s.is_default && (
                  <span style={{ fontSize: 10, background: "var(--accent-color)", color: "#fff", padding: "1px 5px", borderRadius: 3 }}>
                    Default
                  </span>
                )}
                {s.is_translation && (
                  <span style={{ fontSize: 10, background: "var(--success-color)", color: "#fff", padding: "1px 5px", borderRadius: 3 }}>
                    Translate
                  </span>
                )}
                <button onClick={(e) => { e.stopPropagation(); handleTest(s.id); }} disabled={testing} title="Test connection"
                  style={{
                    padding: "2px 6px", background: "transparent",
                    color: editingId === s.id ? "#fff" : "var(--accent-color)",
                    border: `1px solid ${editingId === s.id ? "#fff" : "var(--accent-color)"}`,
                    borderRadius: 3, fontSize: 13, lineHeight: 1, cursor: "pointer",
                  }}>
                  {testing ? "⏳" : "▶"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
