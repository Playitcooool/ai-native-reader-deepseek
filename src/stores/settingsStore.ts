import { create } from "zustand";

export interface ProviderSettings {
  id: string;
  provider_type: string;
  base_url: string | null;
  api_key: string | null;
  model: string;
  is_default: boolean | null;
  is_translation: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderSettingsInput {
  id?: string;
  provider_type: string;
  base_url?: string;
  api_key?: string;
  model: string;
  is_default?: boolean;
  is_translation?: boolean;
}

interface SettingsState {
  settings: ProviderSettings[];
  showSettings: boolean;
  theme: "light" | "dark";
  setSettings: (settings: ProviderSettings[]) => void;
  addSetting: (setting: ProviderSettings) => void;
  updateSetting: (id: string, setting: ProviderSettings) => void;
  toggleSettings: () => void;
  setTheme: (theme: "light" | "dark") => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: [],
  showSettings: false,
  theme: (localStorage.getItem("reader-theme") as "light" | "dark") ?? "light",
  setSettings: (settings) => set({ settings }),
  addSetting: (setting) =>
    set((state) => ({ settings: [...state.settings, setting] })),
  updateSetting: (id, updated) =>
    set((state) => ({
      settings: state.settings.map((s) => (s.id === id ? updated : s)),
    })),
  toggleSettings: () =>
    set((state) => ({ showSettings: !state.showSettings })),
  setTheme: (theme) => {
    localStorage.setItem("reader-theme", theme);
    set({ theme });
  },
}));
