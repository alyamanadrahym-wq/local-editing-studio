import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import React, { useEffect, useState } from 'react';
import { useStore, updateEngine, updateProject, updateSettings, type Take, type TimelineItem } from '@/lib/store';
import { getLocalMedia, localEngine, type RenderResult } from '@/lib/local-media';
import { MonitorPlay, Download, History, Clock, FileJson2, Captions, RotateCcw, ShieldCheck, Square, Film, Upload } from 'lucide-react';

function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toSrtTimestamp(seconds: number): string {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(millis / 3_600_000);
  const minutes = Math.floor((millis % 3_600_000) / 60_000);
  const secs = Math.floor((millis % 60_000) / 1000);
  const ms = millis % 1000;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

function createDraftSrt(takes: Take[], timeline: TimelineItem[]): string {
  let cursor = 0;
  const blocks: string[] = [];
  [...timeline].sort((a, b) => a.order - b.order).forEach((item) => {
    const take = takes.find((candidate) => candidate.id === item.takeId);
    if (!take) return;
    const duration = Math.max(0, take.end - take.start);
    if (take.edit?.caption) {
      blocks.push(`${blocks.length + 1}\n${toSrtTimestamp(cursor)} --> ${toSrtTimestamp(cursor + duration)}\n${take.edit.caption}`);
    }
    cursor += duration;
  });
  return blocks.join('\n\n');
}

export default function Export() {
  const { project, settings, engine } = useStore();
  const [downloadError, setDownloadError] = useState<string>();
  const [uploadProgress, setUploadProgress] = useState(0);
  const requestController = React.useRef<AbortController | null>(null);
  const planInputRef = React.useRef<HTMLInputElement>(null);
  const [planMessage, setPlanMessage] = useState<{ kind: 'error' | 'success'; text: string }>();
  const renderJob = engine.renderJob;
  const isRendering = renderJob?.status === 'queued' || renderJob?.status === 'running';
  const orderedTimeline = [...project.timeline].sort((a, b) => a.order - b.order);
  const totalDuration = orderedTimeline.reduce((sum, item) => {
    const take = project.takes.find((candidate) => candidate.id === item.takeId);
    return sum + (take ? take.end - take.start : 0);
  }, 0);
  const hasPlannedCaptions = orderedTimeline.some((item) => project.takes.find((take) => take.id === item.takeId)?.edit?.caption);

  const saveVersion = () => {
    updateProject((current) => {
      const timelineStyleId = current.timeline
        .map((item) => current.takes.find((take) => take.id === item.takeId)?.edit?.styleProfileId)
        .find(Boolean);
      return {
        versions: [
          {
          id: crypto.randomUUID(),
          name: `Draft v${current.versions.length + 1}`,
          timeline: current.timeline.map((item) => ({ ...item })),
          createdAt: Date.now(),
          styleProfileId: timelineStyleId ?? settings.styleProfile,
          },
          ...current.versions,
        ],
      };
    });
  };

  const restoreVersion = (versionId: string) => {
    const version = project.versions.find((item) => item.id === versionId);
    if (!version) return;
    updateProject((current) => ({
      timeline: version.timeline.map((item, index) => ({ ...item, order: index })),
      takes: current.takes.map((take) => ({ ...take, selected: version.timeline.some((item) => item.takeId === take.id) })),
    }));
    const versionStyleId = version.styleProfileId
      ?? version.timeline.map((item) => project.takes.find((take) => take.id === item.takeId)?.edit?.styleProfileId).find(Boolean);
    if (versionStyleId) {
      updateSettings(() => ({ styleProfile: versionStyleId }));
    }
  };

  const exportPlan = () => {
    const manifest = {
      format: 'local-editing-studio/edit-plan',
      version: 1,
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        script: project.script,
        styleProfile: settings.styleProfile,
        assets: project.assets.map(({ id, name, type, duration, size, mimeType }) => ({ id, name, type, duration, size, mimeType })),
        takes: project.takes,
        timeline: orderedTimeline,
         transcript: project.transcript,
      },
    };
    downloadFile(`${project.name || 'edit-plan'}.json`, JSON.stringify(manifest, null, 2), 'application/json');
  };

  const openEditPlan = async (file?: File) => {
    if (!file) return;
    setPlanMessage(undefined);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object') throw new Error('This file is not a JSON edit plan.');
      const root = parsed as { plan?: unknown; project?: unknown };
      const source = root.plan ?? root.project;
      if (!source || typeof source !== 'object') throw new Error('Expected an engine plan (`plan`) or portable draft manifest (`project`).');
      const plan = source as Record<string, unknown>;
      if (!Array.isArray(plan.takes) || !Array.isArray(plan.timeline)) throw new Error('The plan must contain takes and timeline arrays.');
      const takes: Take[] = plan.takes.map((raw, index) => {
        if (!raw || typeof raw !== 'object') throw new Error(`Take ${index + 1} is invalid.`);
        const take = raw as Record<string, unknown>;
        const assetId = String(take.assetId ?? take.asset_id ?? '');
        const start = Number(take.start);
        const end = Number(take.end);
        if (!String(take.id ?? '') || !assetId || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error(`Take ${index + 1} has missing media or an invalid time range.`);
        const score = Number(take.score ?? take.rating ?? 3);
        return {
          id: String(take.id),
          assetId,
          start,
          end,
          notes: String(take.notes ?? take.text ?? ''),
          selected: Boolean(take.selected),
          score,
          rating: Math.max(1, Math.min(5, Math.round(Number(take.rating ?? (score > 5 ? score / 20 : score))))) as 1 | 2 | 3 | 4 | 5,
          reasons: Array.isArray(take.reasons) ? take.reasons.filter((reason): reason is string => typeof reason === 'string') : [],
        };
      });
      const knownTakes = new Set(takes.map((take) => take.id));
      const timeline: TimelineItem[] = plan.timeline.map((raw, index) => {
        if (!raw || typeof raw !== 'object') throw new Error(`Timeline item ${index + 1} is invalid.`);
        const item = raw as Record<string, unknown>;
        const takeId = String(item.takeId ?? item.take_id ?? '');
        if (!knownTakes.has(takeId)) throw new Error(`Timeline item ${index + 1} refers to a take not included in this plan.`);
        return { id: String(item.id ?? crypto.randomUUID()), takeId, order: Number.isFinite(Number(item.order)) ? Number(item.order) : index };
      });
      const assetIds = [...new Set(takes.map((take) => take.assetId))];
      const currentIds = new Set(project.assets.map((asset) => asset.id));
      const missingCurrent = assetIds.filter((id) => !currentIds.has(id));
      const stored = await Promise.all(assetIds.map(async (id) => ({ id, file: await getLocalMedia(id).catch(() => undefined) })));
      const missingLocal = stored.filter((item) => !item.file).map((item) => item.id);
      const missing = [...new Set([...missingCurrent, ...missingLocal])];
      if (missing.length) throw new Error(`Plan cannot be opened: referenced media is missing locally (${missing.join(', ')}). Import the original media with matching asset IDs first.`);
      const rawTranscript = plan.transcript;
      const transcriptData = rawTranscript && typeof rawTranscript === 'object' ? rawTranscript as Record<string, unknown> : null;
      const transcript = rawTranscript && typeof rawTranscript === 'object'
        ? {
            text: String(transcriptData?.text ?? ''),
            language: typeof transcriptData?.language === 'string' ? transcriptData.language : undefined,
            words: Array.isArray(transcriptData?.words)
              ? transcriptData.words.flatMap((rawWord) => {
                  if (!rawWord || typeof rawWord !== 'object') return [];
                  const word = rawWord as Record<string, unknown>;
                  const start = Number(word.start);
                  const end = Number(word.end);
                  if (typeof word.word !== 'string' || !Number.isFinite(start) || !Number.isFinite(end)) return [];
                  return [{ word: word.word, start, end, confidence: typeof word.confidence === 'number' ? word.confidence : undefined, assetId: typeof word.assetId === 'string' ? word.assetId : typeof word.asset_id === 'string' ? word.asset_id : undefined }];
                })
              : [],
          }
        : null;
      updateProject(() => ({
        name: typeof plan.name === 'string' ? plan.name : project.name,
        script: typeof plan.script === 'string' ? plan.script : project.script,
        takes,
        timeline: timeline.sort((a, b) => a.order - b.order).map((item, index) => ({ ...item, order: index })),
        transcript,
      }));
      const style = plan.styleProfile ?? plan.style_profile;
      if (typeof style === 'string') updateSettings(() => ({ styleProfile: style }));
      setPlanMessage({ kind: 'success', text: `Opened ${file.name}. ${takes.length} takes and ${timeline.length} timeline clips restored.` });
    } catch (error) {
      setPlanMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not open this edit plan.' });
    } finally {
      if (planInputRef.current) planInputRef.current.value = '';
    }
  };

  const exportCaptions = () => {
    downloadFile(`${project.name || 'captions'}.srt`, createDraftSrt(project.takes, project.timeline), 'application/x-subrip');
  };

  useEffect(() => {
    if (!renderJob || !isRendering) return;
    let active = true;
    const poll = async () => {
      try {
        localEngine.setPairingToken(settings.pairingToken);
        const job = await localEngine.getJob<RenderResult>(renderJob.id);
        if (!active) return;
        updateEngine(() => ({
          status: 'connected',
          error: undefined,
          renderJob: { ...job, updatedAt: Date.now() },
          exportResult: job.status === 'completed' && job.result
            ? { jobId: job.id, ...job.result, completedAt: Date.now() }
            : engine.exportResult,
        }));
        if (job.status === 'completed' && !job.result) {
          updateEngine(() => ({ renderJob: { ...job, status: 'failed', error: 'Render completed without downloadable files.', updatedAt: Date.now() } }));
        }
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Could not read render progress.';
        updateEngine(() => ({ status: 'disconnected', error: message, renderJob: { ...renderJob, status: 'failed', error: message, updatedAt: Date.now() } }));
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1200);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [renderJob?.id, isRendering, settings.pairingToken]);

  const startRender = async () => {
    if (orderedTimeline.length === 0) return;
    updateEngine(() => ({ status: 'checking', error: undefined, renderJob: null, exportResult: null }));
    setUploadProgress(0);
    localEngine.setPairingToken(settings.pairingToken);
    const controller = new AbortController();
    requestController.current = controller;
    const uploadedIds: string[] = [];
    try {
      const health = await localEngine.health(controller.signal);
      updateEngine(() => ({ ...health, status: 'connected', lastCheckedAt: Date.now() }));
      const media: { id: string; assetId: string }[] = [];
      const uploadedMedia = { ...engine.uploadedMedia };
      for (const [index, asset] of project.assets.entries()) {
        const file = await getLocalMedia(asset.id);
        if (!file) throw new Error(`${asset.name} is missing from browser storage. Re-import it before rendering.`);
        const uploaded = await localEngine.uploadMedia(asset.id, file, {
          signal: controller.signal,
          onProgress: (assetProgress) => setUploadProgress((index + assetProgress) / project.assets.length),
        });
        uploadedMedia[asset.id] = uploaded.id;
        media.push(uploaded);
        uploadedIds.push(asset.id);
        setUploadProgress((index + 1) / project.assets.length);
      }
      const job = await localEngine.startRender({
        projectId: project.id,
        name: project.name,
        script: project.script,
        media,
        takes: project.takes.map((take) => ({
          id: take.id,
          assetId: take.assetId,
          start: take.start,
          end: take.end,
          notes: take.notes,
          score: take.score ?? take.rating,
          reasons: take.reasons,
          selected: take.selected,
        })),
        timeline: orderedTimeline,
        transcript: project.transcript ?? undefined,
        styleProfile: settings.styleProfile,
      });
      updateEngine(() => ({ uploadedMedia, renderJob: { ...job, updatedAt: Date.now() } }));
    } catch (error) {
      if (controller.signal.aborted) {
        await Promise.all(uploadedIds.map((id) => localEngine.deleteUploadedMedia(id).catch(() => undefined)));
      }
      updateEngine(() => ({ status: controller.signal.aborted ? 'connected' : 'disconnected', error: controller.signal.aborted ? 'Render setup cancelled. Partial local-engine uploads were removed.' : error instanceof Error ? error.message : 'Render could not start.' }));
    } finally {
      setUploadProgress(0);
      requestController.current = null;
    }
  };

  const cancelRender = async () => {
    if (requestController.current) {
      requestController.current.abort();
      return;
    }
    if (!renderJob) return;
    localEngine.setPairingToken(settings.pairingToken);
    try {
      const job = await localEngine.cancelJob(renderJob.id);
      updateEngine(() => ({ renderJob: { ...job, updatedAt: Date.now() } }));
    } catch (error) {
      updateEngine(() => ({ error: error instanceof Error ? error.message : 'Could not cancel render.' }));
    }
  };

  const downloadEngineFile = async (kind: 'mp4' | 'srt' | 'json') => {
    const result = engine.exportResult;
    if (!result) return;
    setDownloadError(undefined);
    try {
      localEngine.setPairingToken(settings.pairingToken);
      const path = kind === 'mp4' ? result.mp4Url : kind === 'srt' ? result.srtUrl : result.jsonUrl;
      const blob = await localEngine.download(path);
      downloadBlob(`${result.fileName ?? (project.name || 'export')}.${kind}`, blob);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Download failed.');
    }
  };

  const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center px-6 justify-between bg-card shrink-0">
        <div className="flex items-center gap-3">
          <MonitorPlay className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg text-foreground tracking-tight">Export & Versions</h1>
        </div>
        <Badge variant="outline" className="gap-1.5 border-emerald-400/30 text-emerald-300"><ShieldCheck className="w-3 h-3" /> Local package</Badge>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
          <div className="max-w-lg w-full bg-card border border-border rounded-xl p-8 shadow-lg shadow-black/20">
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
              <FileJson2 className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Prepare your local edit</h2>
            <p className="text-muted-foreground mb-7 text-sm leading-relaxed">
               Render the reviewed timeline with the local FFmpeg engine. Media is sent only to 127.0.0.1, never to a cloud server.
            </p>

            <div className="grid grid-cols-3 gap-3 mb-7">
              <div className="rounded-lg border border-border bg-background p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Clips</p><p className="text-lg font-mono mt-1">{orderedTimeline.length}</p></div>
              <div className="rounded-lg border border-border bg-background p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration</p><p className="text-lg font-mono mt-1">{Math.round(totalDuration)}s</p></div>
              <div className="rounded-lg border border-border bg-background p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Style</p><p className="text-sm font-medium mt-1 truncate">{settings.styleProfile}</p></div>
            </div>

            <div className="flex flex-col gap-3">
              <input ref={planInputRef} data-testid="input-open-edit-plan" type="file" accept="application/json,.json" className="sr-only" onChange={(event) => void openEditPlan(event.target.files?.[0])} />
              <Button data-testid="button-open-edit-plan" onClick={() => planInputRef.current?.click()} variant="outline" className="w-full h-10 gap-2">
                <Upload className="w-4 h-4" /> Open edit plan
              </Button>
              {planMessage && <p data-testid="status-open-edit-plan" className={`text-xs leading-relaxed ${planMessage.kind === 'error' ? 'text-destructive' : 'text-emerald-300'}`}>{planMessage.text}</p>}
              <Button data-testid="button-start-render" onClick={() => void startRender()} disabled={orderedTimeline.length === 0 || isRendering || engine.status === 'checking'} className="w-full h-12 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
                <Film className="w-5 h-5" /> {isRendering ? `${renderJob?.stage ?? 'Rendering'} · ${Math.round((renderJob?.progress ?? 0) * 100)}%` : engine.status === 'checking' ? uploadProgress ? `Uploading media · ${Math.round(uploadProgress * 100)}%` : 'Connecting to engine…' : 'Render MP4 locally'}
              </Button>
              {(isRendering || engine.status === 'checking') && (
                <div data-testid="status-render-progress" className="space-y-2">
                  <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${(renderJob?.progress ?? 0) * 100}%` }} /></div>
                  <Button data-testid="button-cancel-render" onClick={() => void cancelRender()} variant="outline" className="w-full h-8 text-destructive"><Square className="w-3 h-3 mr-2" /> Cancel render</Button>
                </div>
              )}
              {(renderJob?.error || engine.error) && <p data-testid="status-render-error" className="text-xs text-destructive">{renderJob?.error || engine.error}</p>}
              {renderJob?.status === 'cancelled' && <p className="text-xs text-muted-foreground">Render cancelled. No output was created.</p>}
              {engine.exportResult && (
                <div data-testid="status-render-complete" className="grid grid-cols-3 gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3">
                  <Button data-testid="button-download-mp4" onClick={() => void downloadEngineFile('mp4')} variant="outline" size="sm">MP4</Button>
                  <Button data-testid="button-download-srt" onClick={() => void downloadEngineFile('srt')} variant="outline" size="sm">SRT</Button>
                  <Button data-testid="button-download-json" onClick={() => void downloadEngineFile('json')} variant="outline" size="sm">JSON</Button>
                </div>
              )}
              {downloadError && <p className="text-xs text-destructive">{downloadError}</p>}
              <Button onClick={exportPlan} disabled={orderedTimeline.length === 0} className="w-full h-12 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
                <Download className="w-5 h-5" /> Download portable draft plan
              </Button>
              <Button onClick={exportCaptions} disabled={!hasPlannedCaptions} variant="outline" className="w-full h-10 gap-2">
                <Captions className="w-4 h-4" /> Download draft captions (.srt)
              </Button>
              <Button onClick={saveVersion} disabled={orderedTimeline.length === 0} variant="ghost" className="w-full h-10 gap-2 text-muted-foreground hover:text-foreground">
                <History className="w-4 h-4" /> Save current timeline as version
              </Button>
            </div>
            {orderedTimeline.length === 0 && <p className="text-xs text-amber-300/80 mt-4">Build a timeline in the Script or Studio view before exporting.</p>}
          </div>
        </div>

        <div className="w-80 border-l border-border bg-card flex flex-col shrink-0">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold">Version History</h3>
            <Badge variant="secondary" className="font-mono">{project.versions.length}</Badge>
          </div>
          <ScrollArea className="flex-1 p-4">
            {project.versions.length > 0 ? (
              <div className="space-y-3">
                {project.versions.map((version) => (
                  <div key={version.id} className="p-3 border border-border rounded-lg hover:border-primary/50 transition-colors bg-background group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm text-foreground">{version.name}</span>
                      <Button onClick={() => restoreVersion(version.id)} variant="ghost" size="sm" className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 hover:text-primary gap-1">
                        <RotateCcw className="w-3 h-3" /> Restore
                      </Button>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-muted-foreground font-mono">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {formatDate(version.createdAt)}</span>
                      <span>{version.timeline.length} clips</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <History className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No versions saved yet.</p>
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
