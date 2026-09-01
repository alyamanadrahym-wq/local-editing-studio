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
  score?: number;
  reasons: string[];
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
  transcript: {
    text: string;
    language?: string;
    words: { word: string; start: number; end: number; confidence?: number; assetId?: string }[];
  } | null;
};

export type JobMetadata = {
  id: string;
  type: 'analysis' | 'render';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage?: string;
  error?: string;
  updatedAt: number;
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
    audioActivity?: string;
  };
  inference?: {
    sourceCount: number;
    analyzedAt: number;
    privacy: 'browser-local';
    evidence: Record<string, {
      confidence: number;
      source: string;
      detail: string;
    }>;
  };
};

export type SettingsState = {
  privacyMode: 'local' | 'hybrid';
  modelProvider: 'none' | 'gemini' | 'openrouter';
  styleProfile: string;
  pairingToken: string;
  customProfiles: CustomStyleProfile[];
};

export type AppState = {
  project: ProjectState;
  settings: SettingsState;
  engine: EngineState;
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
    transcript: null,
  },
  settings: {
    privacyMode: 'local',
    modelProvider: 'none',
    styleProfile: 'cinematic',
    pairingToken: '',
    customProfiles: [],
  },
  engine: {
    status: 'unknown',
    analysisJob: null,
    renderJob: null,
    uploadedMedia: {},
    exportResult: null,
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
          project: {
            ...defaultState.project,
            ...parsed.project,
            assets: parsed.project?.assets ?? [],
            takes: (parsed.project?.takes ?? []).map((take) => ({ ...take, reasons: take.reasons ?? (take.notes ? [take.notes] : []) })),
            timeline: parsed.project?.timeline ?? [],
            versions: parsed.project?.versions ?? [],
            transcript: parsed.project?.transcript ?? null,
          },
          settings: {
            privacyMode: parsedSettings?.privacyMode === 'hybrid' ? 'hybrid' : 'local',
            modelProvider: ['none', 'gemini', 'openrouter'].includes(parsedSettings?.modelProvider ?? '')
              ? parsedSettings?.modelProvider as SettingsState['modelProvider'] ?? 'none'
              : 'none',
            styleProfile: parsedSettings?.styleProfile || defaultState.settings.styleProfile,
            pairingToken: typeof parsedSettings?.pairingToken === 'string' ? parsedSettings.pairingToken : '',
             customProfiles: Array.isArray(parsedSettings?.customProfiles)
               ? parsedSettings.customProfiles.filter(isCustomStyleProfile).map(migrateCustomStyleProfile)
               : [],
          },
          engine: {
            ...defaultState.engine,
            ...parsed.engine,
            status: 'unknown',
            uploadedMedia: parsed.engine?.uploadedMedia ?? {},
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

function isCustomStyleProfile(value: unknown): value is CustomStyleProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<CustomStyleProfile>;
  const traits = profile.traits as Partial<CustomStyleProfile['traits']> | undefined;
  return typeof profile.id === 'string'
    && typeof profile.name === 'string'
    && typeof profile.description === 'string'
    && Array.isArray(profile.tags)
    && !!traits
    && typeof traits.cuttingPace === 'string'
    && typeof traits.bRollDensity === 'string'
    && typeof traits.captions === 'boolean'
    && typeof traits.zoom === 'boolean';
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

export const updateEngine = (fn: (engine: EngineState) => Partial<EngineState>) => {
  store.setState((state) => ({
    ...state,
    engine: { ...state.engine, ...fn(state.engine) },
  }));
};
export const clearStore = () => {
  store.setState(() => defaultState);
};

export type EngineState = {
  status: 'unknown' | 'checking' | 'connected' | 'disconnected';
  version?: string;
  gpu?: { available: boolean; name?: string; nvencAvailable?: boolean; selectedEncoder?: string };
  whisper?: { available: boolean; model?: string };
  lastCheckedAt?: number;
  error?: string;
  analysisJob: JobMetadata | null;
  renderJob: JobMetadata | null;
  uploadedMedia: Record<string, string>;
  exportResult: {
    jobId: string;
    mp4Url: string;
    srtUrl: string;
    jsonUrl: string;
    fileName?: string;
    completedAt: number;
  } | null;
};

function migrateCustomStyleProfile(profile: CustomStyleProfile): CustomStyleProfile {
  const inference = profile.inference;
  return {
    ...profile,
    tags: profile.tags.filter((tag): tag is string => typeof tag === 'string'),
    traits: {
      ...profile.traits,
      audioActivity: typeof profile.traits.audioActivity === 'string'
        ? profile.traits.audioActivity
        : 'Unknown',
    },
    inference: inference?.privacy === 'browser-local' && inference.evidence
      ? inference
      : undefined,
  };
}
