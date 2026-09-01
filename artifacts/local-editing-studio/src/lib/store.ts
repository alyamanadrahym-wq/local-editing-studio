import { useSyncExternalStore } from 'react';

export type AssetItem = {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'image';
  url: string;
  duration?: number;
  size?: number;
  mimeType?: string;
  addedAt: number;
};

export type Take = {
  id: string;
  assetId: string;
  start: number;
  end: number;
  notes: string;
  selected: boolean;
  rating: 1 | 2 | 3 | 4 | 5;
  edit?: {
    styleProfileId: string;
    role: 'a-roll' | 'b-roll';
    caption: string | null;
    zoomScale: number;
    bRollDensity: string;
  };
};

export type TimelineItem = {
  id: string;
  takeId: string;
  order: number;
};

export type ProjectState = {
  id: string;
  name: string;
  script: string;
  assets: AssetItem[];
  takes: Take[];
  timeline: TimelineItem[];
  versions: { id: string; name: string; timeline: TimelineItem[]; createdAt: number; styleProfileId?: string }[];
};

export type CustomStyleProfile = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  traits: {
    cuttingPace: string;
    bRollDensity: string;
    captions: boolean;
    zoom: boolean;
  };
};

export type SettingsState = {
  privacyMode: 'local' | 'hybrid';
  modelProvider: string;
  styleProfile: string;
  customProfiles: CustomStyleProfile[];
};

export type AppState = {
  project: ProjectState;
  settings: SettingsState;
};

const defaultState: AppState = {
  project: {
    id: 'default-proj',
    name: 'Untitled Project',
    script: '',
    assets: [],
    takes: [],
    timeline: [],
    versions: [],
  },
  settings: {
    privacyMode: 'local',
    modelProvider: 'none',
    styleProfile: 'cinematic',
    customProfiles: [],
  },
};

class Store {
  private state: AppState;
  private listeners: Set<() => void> = new Set();

  constructor() {
    const saved = localStorage.getItem('local-editing-studio-store');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<AppState>;
        const parsedSettings = parsed.settings;
        this.state = {
          ...defaultState,
          ...parsed,
          project: { ...defaultState.project, ...parsed.project },
          settings: {
            privacyMode: parsedSettings?.privacyMode === 'hybrid' ? 'hybrid' : 'local',
            modelProvider: ['none', 'gemini', 'openrouter'].includes(parsedSettings?.modelProvider ?? '')
              ? parsedSettings?.modelProvider ?? 'none'
              : 'none',
            styleProfile: parsedSettings?.styleProfile || defaultState.settings.styleProfile,
            customProfiles: Array.isArray(parsedSettings?.customProfiles) ? parsedSettings.customProfiles : [],
          },
        };
      } catch {
        this.state = defaultState;
      }
    } else {
      this.state = defaultState;
    }
    localStorage.setItem('local-editing-studio-store', JSON.stringify(this.state));
  }

  getState = () => this.state;

  setState = (fn: (state: AppState) => AppState) => {
    this.state = fn(this.state);
    localStorage.setItem('local-editing-studio-store', JSON.stringify(this.state));
    this.emit();
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit = () => {
    for (const listener of this.listeners) {
      listener();
    }
  };
}

const store = new Store();

export function useStore(): AppState;
export function useStore<T>(selector: (state: AppState) => T): T;
export function useStore<T>(selector?: (state: AppState) => T) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return selector ? selector(state) : state;
}

export const updateProject = (fn: (project: ProjectState) => Partial<ProjectState>) => {
  store.setState((state) => ({
    ...state,
    project: { ...state.project, ...fn(state.project) },
  }));
};

export const updateSettings = (fn: (settings: SettingsState) => Partial<SettingsState>) => {
  store.setState((state) => ({
    ...state,
    settings: { ...state.settings, ...fn(state.settings) },
  }));
};

export const clearStore = () => {
  store.setState(() => defaultState);
};
