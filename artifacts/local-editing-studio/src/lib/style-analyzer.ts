import type { CustomStyleProfile } from '@/lib/store';

export type TraitEvidence = {
  confidence: number;
  source: string;
  detail: string;
};

export type FileStyleAnalysis = {
  fileName: string;
  duration: number;
  sampledFrames: number;
  detectedCuts: number;
  motionScore: number;
  textFrameRatio: number;
  zoomScore: number;
  audioActivity: 'Low' | 'Moderate' | 'High' | 'Unavailable';
  audioActiveRatio?: number;
  warning?: string;
  traits: CustomStyleProfile['traits'];
  evidence: Record<string, TraitEvidence>;
};

export type AggregateStyleAnalysis = {
  traits: CustomStyleProfile['traits'];
  evidence: Record<string, TraitEvidence>;
  files: FileStyleAnalysis[];
};

type FrameSample = {
  time: number;
  pixels: Float32Array;
  edgeDensity: number;
  lowerEdgeDensity: number;
  radialEdgeCenter: number;
};

const waitFor = (element: HTMLMediaElement, event: string, timeout = 15000) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out while reading ${event}.`));
    }, timeout);
    const cleanup = () => {
      window.clearTimeout(timer);
      element.removeEventListener(event, done);
      element.removeEventListener('error', failed);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      const mediaError = element.error;
      const detail = mediaError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'Its video codec or container is not supported by this browser. Try WebM (VP8/VP9) or a browser-supported MP4.'
        : 'The browser could not decode its video stream.';
      reject(new Error(detail));
    };
    element.addEventListener(event, done, { once: true });
    element.addEventListener('error', failed, { once: true });
  });

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const clampConfidence = (value: number) => Math.round(Math.max(0.2, Math.min(0.98, value)) * 100);

function classifyLevel(score: number, low: number, high: number): 'Low' | 'Moderate' | 'High' {
  return score < low ? 'Low' : score > high ? 'High' : 'Moderate';
}

function inspectFrame(context: CanvasRenderingContext2D, width: number, height: number, time: number): FrameSample {
  const rgba = context.getImageData(0, 0, width, height).data;
  const pixels = new Float32Array(width * height);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    pixels[index] = (rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114) / 255;
  }

  let edges = 0;
  let lowerEdges = 0;
  let lowerComparisons = 0;
  let radialWeight = 0;
  let edgeWeight = 0;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const maxRadius = Math.hypot(centerX, centerY);
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const index = y * width + x;
      const strength = Math.abs(pixels[index] - pixels[index + 1])
        + Math.abs(pixels[index] - pixels[index + width]);
      const isEdge = strength > 0.32;
      if (isEdge) {
        edges += 1;
        const radius = Math.hypot(x - centerX, y - centerY) / maxRadius;
        radialWeight += radius * strength;
        edgeWeight += strength;
        if (y > height * 0.58) lowerEdges += 1;
      }
      if (y > height * 0.58) lowerComparisons += 1;
    }
  }
  const comparisons = (width - 1) * (height - 1);
  return {
    time,
    pixels,
    edgeDensity: edges / comparisons,
    lowerEdgeDensity: lowerEdges / Math.max(1, lowerComparisons),
    radialEdgeCenter: edgeWeight ? radialWeight / edgeWeight : 0.5,
  };
}

function frameDifference(first: Float32Array, second: Float32Array) {
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference += Math.abs(first[index] - second[index]);
  }
  return difference / first.length;
}

async function sampleFrames(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;
  try {
    await waitFor(video, 'loadedmetadata');
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error('This video has no readable duration.');
    }
    const duration = video.duration;
    const shortSampleCount = Math.max(12, Math.ceil(duration / 0.75));
    const sampleTimes: number[] = duration <= 45
      ? Array.from(
          { length: shortSampleCount },
          (_, index) => ((index + 0.5) / shortSampleCount) * duration,
        )
      : Array.from({ length: 5 }, (_, windowIndex) => {
          const windowLength = 5.4;
          const start = (windowIndex / 4) * Math.max(0, duration - windowLength);
          return Array.from({ length: 10 }, (_, index) => start + index * 0.6);
        }).flat();
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = Math.max(36, Math.round(64 / Math.max(0.5, video.videoWidth / video.videoHeight)));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas frame analysis is unavailable.');

    const samples: FrameSample[] = [];
    for (const sampleTime of sampleTimes) {
      const time = Math.min(duration - 0.05, sampleTime);
      if (Math.abs(video.currentTime - time) > 0.01) {
        video.currentTime = Math.max(0, time);
        await waitFor(video, 'seeked');
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      samples.push(inspectFrame(context, canvas.width, canvas.height, time));
    }
    return { duration, samples };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

async function sampleAudio(file: File, duration: number) {
  if (file.size > 100 * 1024 * 1024 || duration > 180) {
    throw new Error('Audio sampling is limited to 3 minutes and 100 MB to protect browser memory.');
  }
  const AudioContextConstructor = window.AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Web Audio is unavailable in this browser.');
  const context = new AudioContextConstructor();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const windowCount = 80;
    const rmsValues: number[] = [];
    for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
      const start = Math.floor((windowIndex / windowCount) * buffer.length);
      const end = Math.max(start + 1, Math.floor(((windowIndex + 1) / windowCount) * buffer.length));
      const stride = Math.max(1, Math.floor((end - start) / 1200));
      let squared = 0;
      let count = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = start; index < end; index += stride) {
          squared += data[index] * data[index];
          count += 1;
        }
      }
      rmsValues.push(Math.sqrt(squared / Math.max(1, count)));
    }
    const peak = Math.max(...rmsValues);
    const threshold = Math.max(0.008, peak * 0.09);
    const activeRatio = rmsValues.filter((value) => value > threshold).length / rmsValues.length;
    return {
      activeRatio,
      level: classifyLevel(activeRatio, 0.36, 0.7),
      windows: rmsValues.length,
    };
  } finally {
    void context.close();
  }
}

export async function analyzeStyleFile(file: File): Promise<FileStyleAnalysis> {
  const { duration, samples } = await sampleFrames(file);
  const transitions = samples.slice(1).map((sample, index) => ({
    index,
    seconds: sample.time - samples[index].time,
    value: frameDifference(samples[index].pixels, sample.pixels),
  })).filter((transition) => transition.seconds <= 1);
  const differences = transitions.map((transition) => transition.value);
  const baseDifference = median(differences);
  const deviation = median(differences.map((value) => Math.abs(value - baseDifference)));
  const cutThreshold = Math.max(0.14, baseDifference + Math.max(0.055, deviation * 2.8));
  const cutIndexes = new Set(transitions.filter(({ value }) => value > cutThreshold).map(({ index }) => index));
  const cuts = cutIndexes.size;
  const observedSeconds = transitions.reduce((sum, transition) => sum + transition.seconds, 0);
  const coverageRatio = Math.min(1, observedSeconds / duration);
  const cutsPerMinute = cuts / Math.max(observedSeconds / 60, 0.15);
  const motionValues = transitions.filter(({ index }) => !cutIndexes.has(index)).map(({ value }) => value);
  const motionScore = median(motionValues);

  const edgeMedian = median(samples.map((sample) => sample.edgeDensity));
  const textFrames = samples.filter((sample) =>
    sample.lowerEdgeDensity > Math.max(0.075, edgeMedian * 1.12)
  ).length;
  const textFrameRatio = textFrames / samples.length;

  const radialChanges = samples.slice(1)
    .map((sample, index) => ({
      index,
      seconds: sample.time - samples[index].time,
      change: Math.abs(sample.radialEdgeCenter - samples[index].radialEdgeCenter),
    }))
    .filter(({ index, seconds }) => seconds <= 1 && !cutIndexes.has(index))
    .map(({ change }) => change);
  const zoomScore = median(radialChanges);

  let audio: Awaited<ReturnType<typeof sampleAudio>> | undefined;
  let warning: string | undefined;
  try {
    audio = await sampleAudio(file, duration);
  } catch (error) {
    warning = error instanceof Error ? error.message : 'The audio track could not be sampled.';
  }

  const cuttingPace = cutsPerMinute < 3 ? 'Slow' : cutsPerMinute > 8 ? 'Fast' : 'Moderate';
  const visualVariation = Math.min(1, (cutsPerMinute / 12) * 0.65 + (motionScore / 0.12) * 0.35);
  const bRollDensity = classifyLevel(visualVariation, 0.3, 0.66);
  const captions = textFrameRatio >= 0.34;
  const zoom = zoomScore >= 0.028;
  const sampleQuality = Math.min(0.94, 0.48 + samples.length / 100);
  const coverageFactor = 0.4 + Math.sqrt(coverageRatio) * 0.6;
  const sampleConfidence = sampleQuality * coverageFactor;
  const audioActivity = audio?.level ?? 'Unavailable';

  return {
    fileName: file.name,
    duration,
    sampledFrames: samples.length,
    detectedCuts: cuts,
    motionScore,
    textFrameRatio,
    zoomScore,
    audioActivity,
    audioActiveRatio: audio?.activeRatio,
    warning,
    traits: { cuttingPace, bRollDensity, captions, zoom, audioActivity },
    evidence: {
      cuttingPace: {
        confidence: clampConfidence(sampleConfidence * Math.min(1, duration / 12)),
        source: 'Frame changes',
        detail: `${cuts} likely cuts across ${samples.length} frames (${cutsPerMinute.toFixed(1)}/min); sampled ${Math.round(coverageRatio * 100)}% of the timeline.`,
      },
      bRollDensity: {
        confidence: clampConfidence(sampleConfidence * 0.82),
        source: 'Cuts + visual motion',
        detail: `${cutsPerMinute.toFixed(1)} cuts/min; motion score ${(motionScore * 100).toFixed(1)}%; sampled ${Math.round(coverageRatio * 100)}% of the timeline. Visual variety is used as a B-roll proxy.`,
      },
      captions: {
        confidence: clampConfidence(sampleConfidence * 0.78),
        source: 'Lower-frame contrast edges',
        detail: `${Math.round(textFrameRatio * 100)}% of sampled frames contained persistent caption-like edge patterns.`,
      },
      zoom: {
        confidence: clampConfidence(sampleConfidence * 0.72),
        source: 'Edge-scale changes',
        detail: `Radial edge-change score ${(zoomScore * 100).toFixed(1)}% between non-cut frames.`,
      },
      audioActivity: {
        confidence: audio ? 86 : 20,
        source: audio ? 'Decoded audio waveform' : 'Audio unavailable',
        detail: audio
          ? `${Math.round(audio.activeRatio * 100)}% of ${audio.windows} waveform windows were active.`
          : warning ?? 'No decodable audio track was found.',
      },
    },
  };
}

export function aggregateStyleAnalyses(files: FileStyleAnalysis[]): AggregateStyleAnalysis {
  if (!files.length) throw new Error('No videos were successfully analyzed.');
  const paceRank = ['Slow', 'Moderate', 'Fast'];
  const densityRank = ['Low', 'Moderate', 'High'];
  const averageRank = (key: 'cuttingPace' | 'bRollDensity', ranks: string[]) =>
    ranks[Math.round(files.reduce((sum, file) => sum + Math.max(0, ranks.indexOf(file.traits[key])), 0) / files.length)];
  const boolRatio = (key: 'captions' | 'zoom') =>
    files.filter((file) => file.traits[key]).length / files.length;
  const validAudio = files.filter((file) => file.audioActivity !== 'Unavailable');
  const audioActivity = validAudio.length
    ? averageRankForAudio(validAudio, densityRank)
    : 'Unavailable';
  const traits: CustomStyleProfile['traits'] = {
    cuttingPace: averageRank('cuttingPace', paceRank),
    bRollDensity: averageRank('bRollDensity', densityRank),
    captions: boolRatio('captions') >= 0.5,
    zoom: boolRatio('zoom') >= 0.5,
    audioActivity,
  };
  const summaries: Array<[keyof CustomStyleProfile['traits'], string]> = [
    ['cuttingPace', `${files.reduce((sum, file) => sum + file.detectedCuts, 0)} likely cuts found in total.`],
    ['bRollDensity', `Combined cut frequency and motion from ${files.length} video${files.length === 1 ? '' : 's'}.`],
    ['captions', `${files.filter((file) => file.traits.captions).length}/${files.length} videos showed caption-like patterns.`],
    ['zoom', `${files.filter((file) => file.traits.zoom).length}/${files.length} videos showed edge-scale changes.`],
    ['audioActivity', validAudio.length
      ? `Decoded waveform activity from ${validAudio.length}/${files.length} videos.`
      : 'No selected video had browser-decodable audio.'],
  ];
  const evidence = Object.fromEntries(summaries.map(([key, detail]) => {
    const values = files.map((file) => file.evidence[key]?.confidence ?? 20);
    const agreement = key === 'captions' || key === 'zoom'
      ? Math.max(boolRatio(key), 1 - boolRatio(key))
      : files.filter((file) => file.traits[key] === traits[key]).length / files.length;
    return [key, {
      confidence: Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * (0.7 + agreement * 0.3)),
      source: files.length > 1 ? `Aggregated local samples (${files.length} files)` : files[0].evidence[key]?.source,
      detail,
    }];
  }));
  return { traits, evidence, files };
}

function averageRankForAudio(files: FileStyleAnalysis[], ranks: string[]) {
  return ranks[Math.round(files.reduce((sum, file) => sum + Math.max(0, ranks.indexOf(file.audioActivity)), 0) / files.length)];
}