const DB_NAME = 'local-editing-studio-media';
const STORE_NAME = 'files';
const DB_VERSION = 1;

export const LOCAL_ENGINE_ORIGIN = 'http://127.0.0.1:4317';

export type EngineHealth = {
  status: 'ok' | 'degraded';
  version?: string;
  gpu?: {
    available: boolean;
    name?: string;
    nvencAvailable?: boolean;
    selectedEncoder?: string;
  };
  whisper?: {
    available: boolean;
    model?: string;
  };
};

export type TranscriptWord = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  assetId?: string;
};

export type EngineTake = {
  id: string;
  assetId: string;
  start: number;
  end: number;
  notes?: string;
  score: number;
  reasons: string[];
  selected?: boolean;
};

export type EngineTimelineItem = {
  id?: string;
  takeId: string;
  order: number;
};

export type AnalysisResult = {
  transcript: {
    text: string;
    language?: string;
    words: TranscriptWord[];
  };
  takes: EngineTake[];
  timeline: EngineTimelineItem[];
};

export type RenderResult = {
  mp4Url: string;
  srtUrl: string;
  jsonUrl: string;
  fileName?: string;
};

export type EngineJob<T = unknown> = {
  id: string;
  type: 'analysis' | 'render';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage?: string;
  error?: string;
  result?: T;
  createdAt?: string;
  updatedAt?: string;
};

type UploadedMedia = {
  id: string;
  assetId: string;
};

type RawJob = {
  id: string;
  kind: 'analysis' | 'render';
  status: 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  message?: string;
  error?: string;
  created_at?: string;
  updated_at?: string;
};

function engineUrl(path: string): string {
  const url = new URL(path, LOCAL_ENGINE_ORIGIN);
  if (url.origin !== LOCAL_ENGINE_ORIGIN) {
    throw new Error('Refusing to send private media outside the local engine.');
  }
  return url.toString();
}

let pairingToken = '';

async function engineRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isHealth = path === '/health';
  if (!isHealth && !pairingToken.trim()) {
    throw new Error('Pair the browser with the local engine in Settings before sending media or starting a job.');
  }
  let response: Response;
  try {
    response = await fetch(engineUrl(path), {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(!isHealth ? { 'X-Local-Engine-Token': pairingToken } : {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Local engine is disconnected. Start it on 127.0.0.1:4317 and try again.');
  }
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `Local engine request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

function normalizeJob<T>(job: RawJob, result?: T): EngineJob<T> {
  const rawProgress = Number(job.progress ?? 0);
  return {
    id: job.id,
    type: job.kind,
    status: job.status === 'cancelling' ? 'running' : job.status,
    progress: Math.max(0, Math.min(1, rawProgress > 1 ? rawProgress / 100 : rawProgress)),
    stage: job.status === 'cancelling' ? 'Cancelling' : job.message,
    error: job.error,
    result,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

export const localEngine = {
  setPairingToken: (token: string) => {
    pairingToken = token.trim();
  },

  health: async (signal?: AbortSignal): Promise<EngineHealth> => {
    const raw = await engineRequest<{
      status: 'ok' | 'degraded';
      engine_version?: string;
      whisper?: { available: boolean; implementation?: string };
      hardware?: { cuda_available?: boolean; nvidia_gpus?: string[]; nvenc_available?: boolean; selected_encoder?: string; selected_video_encoder?: string };
      ffmpeg?: { nvenc_available?: boolean; selected_encoder?: string; selected_video_encoder?: string };
      h264_nvenc?: { usable?: boolean };
    }>('/health', { signal });
    return {
      status: raw.status,
      version: raw.engine_version,
      gpu: {
        available: Boolean(raw.hardware?.cuda_available),
        name: raw.hardware?.nvidia_gpus?.join(', ') || undefined,
        nvencAvailable: Boolean(raw.h264_nvenc?.usable ?? raw.hardware?.nvenc_available ?? raw.ffmpeg?.nvenc_available),
        selectedEncoder: raw.h264_nvenc?.usable
          ? 'h264_nvenc'
          : raw.hardware?.selected_encoder ?? raw.hardware?.selected_video_encoder ?? raw.ffmpeg?.selected_encoder ?? raw.ffmpeg?.selected_video_encoder ?? 'libx264',
      },
      whisper: {
        available: Boolean(raw.whisper?.available),
        model: raw.whisper?.implementation,
      },
    };
  },

  testPairing: async (): Promise<void> => {
    if (!pairingToken.trim()) throw new Error('Enter the pairing token printed by run.ps1 first.');
    let response: Response;
    try {
      response = await fetch(engineUrl('/jobs/pairing-check'), { headers: { 'X-Local-Engine-Token': pairingToken } });
    } catch {
      throw new Error('Local engine is disconnected. Start it on 127.0.0.1:4317 and try again.');
    }
    // A protected, deliberately nonexistent job returns 404 only after token validation.
    if (response.status === 404) return;
    if (response.status === 401 || response.status === 403) throw new Error('The pairing token was rejected. Copy the token printed by run.ps1 again.');
    if (!response.ok) throw new Error(`Could not verify pairing (${response.status}).`);
  },

  uploadMedia: async (
    assetId: string,
    file: File,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
  ): Promise<UploadedMedia> => {
    let initialized = false;
    try {
    await engineRequest(`/assets/${encodeURIComponent(assetId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        filename: file.name,
        size: file.size,
        mime_type: file.type || null,
        overwrite: true,
      }),
    });
    initialized = true;
    options.onProgress?.(0);
    const chunkSize = 8 * 1024 * 1024;
    for (let start = 0; start < file.size; start += chunkSize) {
      const end = Math.min(file.size, start + chunkSize);
      await engineRequest(`/assets/${encodeURIComponent(assetId)}`, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${start}-${end - 1}/${file.size}` },
        body: file.slice(start, end),
        signal: options.signal,
      });
      options.onProgress?.(end / file.size);
    }
    options.onProgress?.(1);
    return { id: assetId, assetId };
    } catch (error) {
      if (initialized && options.signal?.aborted) {
        void localEngine.deleteUploadedMedia(assetId).catch(() => undefined);
      }
      throw error;
    }
  },

  startAnalysis: (input: {
    projectId: string;
    script: string;
    media: UploadedMedia[];
  }) => engineRequest<RawJob>('/jobs/analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_ids: input.media.map((item) => item.id), language: 'auto', device: 'auto' }),
  }).then((job) => normalizeJob<AnalysisResult>(job)),

  startRender: (input: {
    projectId: string;
    name: string;
    script: string;
    media: UploadedMedia[];
    takes: EngineTake[];
    timeline: EngineTimelineItem[];
    transcript?: AnalysisResult['transcript'];
    styleProfile: string;
  }) => engineRequest<RawJob>('/jobs/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan: {
        project_id: input.projectId,
        name: input.name,
        script: input.script,
        style_profile: input.styleProfile,
        transcript: input.transcript,
        takes: input.takes.map((take) => ({
          id: take.id,
          asset_id: take.assetId,
          start: take.start,
          end: take.end,
          text: take.notes,
          score: take.score,
          reasons: take.reasons,
          selected: take.selected,
        })),
        timeline: input.timeline.map((item) => ({
          id: item.id,
          take_id: item.takeId,
          order: item.order,
        })),
      },
    }),
  }).then((job) => normalizeJob<RenderResult>(job)),

  getJob: async <T>(jobId: string): Promise<EngineJob<T>> => {
    const job = await engineRequest<RawJob>(`/jobs/${encodeURIComponent(jobId)}`);
    if (job.status !== 'completed') return normalizeJob<T>(job);
    const rawResult = await engineRequest<Record<string, unknown>>(`/jobs/${encodeURIComponent(jobId)}/result`);
    if (job.kind === 'analysis') {
      const segments = (rawResult.segments ?? []) as {
        asset_id: string;
        text: string;
        language?: string;
        words?: { word: string; start: number; end: number; probability?: number }[];
      }[];
      const result: AnalysisResult = {
        transcript: {
          text: segments.map((segment) => segment.text).join(' '),
          language: segments.find((segment) => segment.language)?.language,
          words: segments.flatMap((segment) => (segment.words ?? []).map((word) => ({
            word: word.word,
            start: word.start,
            end: word.end,
            confidence: word.probability,
            assetId: segment.asset_id,
          }))),
        },
        takes: ((rawResult.takes ?? []) as {
          id: string; asset_id: string; start: number; end: number; text?: string;
          score: number; reasons?: string[]; selected?: boolean;
        }[]).map((take) => ({
          id: take.id,
          assetId: take.asset_id,
          start: take.start,
          end: take.end,
          notes: take.text,
          score: take.score,
          reasons: take.reasons ?? [],
          selected: take.selected,
        })),
        timeline: ((rawResult.timeline ?? []) as { id?: string; take_id: string; order: number }[]).map((item) => ({
          id: item.id,
          takeId: item.take_id,
          order: item.order,
        })),
      };
      return normalizeJob<T>(job, result as T);
    }
    const files = (rawResult.files ?? []) as { name: string; download_url: string }[];
    const findFile = (name: string) => files.find((file) => file.name === name)?.download_url;
    const mp4Url = findFile('video.mp4');
    const srtUrl = findFile('captions.srt');
    const jsonUrl = findFile('edit-plan.json');
    if (!mp4Url || !srtUrl || !jsonUrl) throw new Error('The render finished but one or more output files are missing.');
    return normalizeJob<T>(job, { mp4Url, srtUrl, jsonUrl } as T);
  },

  cancelJob: (jobId: string) =>
    engineRequest<RawJob>(`/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }).then((job) => normalizeJob(job)),

  deleteUploadedMedia: (assetId: string) =>
    engineRequest<{ deleted: boolean }>(`/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' }),

  download: async (path: string): Promise<Blob> => {
    if (!pairingToken.trim()) throw new Error('Pair the browser with the local engine before downloading output.');
    const url = new URL(path, LOCAL_ENGINE_ORIGIN);
    if (url.origin !== LOCAL_ENGINE_ORIGIN) {
      throw new Error('Refusing to download an engine result from a non-local address.');
    }
    let response: Response;
    try {
      response = await fetch(url, { headers: { 'X-Local-Engine-Token': pairingToken } });
    } catch {
      throw new Error('Could not reach the local engine to download this file.');
    }
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    return response.blob();
  },
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open local media storage.'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function saveLocalMedia(id: string, file: File): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(file, id);
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save local media.'));
    transaction.oncomplete = () => resolve();
  });
  database.close();
}

export async function getLocalMedia(id: string): Promise<File | undefined> {
  const database = await openDatabase();
  const file = await new Promise<File | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onerror = () => reject(request.error ?? new Error('Could not read local media.'));
    request.onsuccess = () => resolve(request.result as File | undefined);
  });
  database.close();
  return file;
}

export async function deleteLocalMedia(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete local media.'));
    transaction.oncomplete = () => resolve();
  });
  database.close();
}

export async function clearLocalMedia(): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear local media.'));
    transaction.oncomplete = () => resolve();
  });
  database.close();
}

export async function restoreLocalAssets<T extends { id: string }>(
  assets: T[],
): Promise<{ assets: (T & { url: string })[]; missingIds: string[] }> {
  const restored: (T & { url: string })[] = [];
  const missingIds: string[] = [];

  for (const asset of assets) {
    const file = await getLocalMedia(asset.id).catch(() => undefined);
    if (!file) {
      missingIds.push(asset.id);
      continue;
    }
    restored.push({ ...asset, url: URL.createObjectURL(file) });
  }

  return { assets: restored, missingIds };
}