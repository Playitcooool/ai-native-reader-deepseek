import { create } from "zustand";

export interface ProviderSettings {
  id: string;
  provider_type: string;
  base_url: string | null;
  api_key: string | null;
  model: string;
  is_default: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderSettingsInput {
  provider_type: string;
  base_url?: string;
  api_key?: string;
  model: string;
  is_default?: boolean;
}

interface SettingsState {
  settings: ProviderSettings[];
  showSettings: boolean;
  setSettings: (settings: ProviderSettings[]) => void;
  addSetting: (setting: ProviderSettings) => void;
  toggleSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: [],
  showSettings: false,
  setSettings: (settings) => set({ settings }),
  addSetting: (setting) =>
    set((state) => ({ settings: [...state.settings, setting] })),
  toggleSettings: () =>
    set((state) => ({ showSettings: !state.showSettings })),
}));
