import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useStore, updateEngine, updateProject, updateSettings, type CustomStyleProfile } from '@/lib/store';
import { getLocalMedia, localEngine, type AnalysisResult } from '@/lib/local-media';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Type, Sparkles, Clock, Wand2, AlertCircle, CheckCircle2, Square, GitBranch, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

const BUILT_IN_TRAITS: Record<string, CustomStyleProfile['traits']> = {
  cinematic: { cuttingPace: 'Slow', bRollDensity: 'Low', captions: false, zoom: false },
  'fast-social': { cuttingPace: 'Fast', bRollDensity: 'High', captions: true, zoom: true },
  documentary: { cuttingPace: 'Moderate', bRollDensity: 'High', captions: false, zoom: false },
  corporate: { cuttingPace: 'Moderate', bRollDensity: 'Moderate', captions: true, zoom: false },
};

function extractCues(script: string): string[] {
  return script
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?؟。])\s+/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export default function Script() {
  const project = useStore((s) => s.project);
  const engine = useStore((s) => s.engine);
  const settings = useStore((s) => s.settings);
  const [content, setContent] = useState(project.script);
  const [isSaving, setIsSaving] = useState(false);
  const [planReady, setPlanReady] = useState(project.timeline.length > 0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [lastSaved, setLastSaved] = useState<Date>(new Date());
  const [showSaveVariantDialog, setShowSaveVariantDialog] = useState(false);
  const [variantName, setVariantName] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [suggestions, setSuggestions] = useState<{
    hooks: string[];
    broll: string[];
    usage: { remaining: number };
    fallback?: boolean;
    message?: string;
  } | null>(null);
  const saveTimeout = useRef<number | undefined>(undefined);
  const requestController = useRef<AbortController | null>(null);
  const analysisJob = engine.analysisJob;
  const isPlanning = analysisJob?.status === 'queued' || analysisJob?.status === 'running';

  useEffect(() => {
    setContent(project.script);
    setPlanReady(project.timeline.length > 0);
  }, [project.id]);

  useEffect(() => {
    if (content === project.script) return;
    setIsSaving(true);
    window.clearTimeout(saveTimeout.current);
    saveTimeout.current = window.setTimeout(() => {
      updateProject(() => ({ script: content }));
      setIsSaving(false);
      setLastSaved(new Date());
    }, 700);
    return () => window.clearTimeout(saveTimeout.current);
  }, [content, project.script]);

  const cues = useMemo(() => extractCues(content), [content]);
  const wordCount = useMemo(() => content.trim().split(/\s+/).filter(Boolean).length, [content]);
  const tags = useMemo(() => Array.from(content.matchAll(/\[(.*?)\]/g), (match) => match[1]).filter(Boolean), [content]);
  const activeTraits = settings.customProfiles.find((profile) => profile.id === settings.styleProfile)?.traits
    ?? BUILT_IN_TRAITS[settings.styleProfile]
    ?? BUILT_IN_TRAITS.cinematic;
  const allProfiles = [
    { id: 'cinematic', name: 'Cinematic Narrative' },
    { id: 'fast-social', name: 'Fast Social (TikTok/Reels)' },
    { id: 'documentary', name: 'Documentary' },
    { id: 'corporate', name: 'Corporate Clean' },
    ...settings.customProfiles,
  ];

  const applyResult = (result: AnalysisResult) => {
    updateProject(() => ({
      transcript: result.transcript,
      takes: result.takes.map((take, index) => {
        const density = activeTraits.bRollDensity.toLocaleLowerCase();
        const useBroll = project.assets.length > 1
          && (density === 'high' ? index % 2 === 1 : density === 'moderate' && index > 0 && index % 3 === 0);
        const caption = activeTraits.captions
          ? result.transcript.words
            .filter((word) => (!word.assetId || word.assetId === take.assetId) && word.start >= take.start && word.end <= take.end)
            .map((word) => word.word)
            .join(' ')
            .trim() || null
          : null;
        return {
          id: take.id,
          assetId: take.assetId,
          start: take.start,
          end: take.end,
          notes: take.notes ?? take.reasons.join(' · '),
          selected: take.selected ?? result.timeline.some((item) => item.takeId === take.id),
          score: take.score,
          reasons: take.reasons,
          rating: Math.max(1, Math.min(5, Math.round(take.score > 5 ? take.score / 20 : take.score))) as 1 | 2 | 3 | 4 | 5,
          edit: {
            styleProfileId: settings.styleProfile,
            role: useBroll ? 'b-roll' as const : 'a-roll' as const,
            caption,
            zoomScale: activeTraits.zoom ? Number((1.04 + (index % 3) * 0.03).toFixed(2)) : 1,
            bRollDensity: activeTraits.bRollDensity,
          },
        };
      }),
      timeline: result.timeline.map((item) => ({
        id: item.id ?? crypto.randomUUID(),
        takeId: item.takeId,
        order: item.order,
      })),
    }));
    setPlanReady(true);
  };

  useEffect(() => {
    if (!analysisJob || !isPlanning) return;
    let active = true;
    const poll = async () => {
      try {
        localEngine.setPairingToken(settings.pairingToken);
        const job = await localEngine.getJob<AnalysisResult>(analysisJob.id);
        if (!active) return;
        updateEngine(() => ({ analysisJob: { ...job, updatedAt: Date.now() } }));
        if (job.status === 'completed') {
          if (!job.result) throw new Error('Analysis completed without a transcript or edit plan.');
          applyResult(job.result);
        }
      } catch (error) {
        if (!active) return;
        updateEngine(() => ({
          status: 'disconnected',
          error: error instanceof Error ? error.message : 'Could not read analysis progress.',
          analysisJob: { ...analysisJob, status: 'failed', error: error instanceof Error ? error.message : 'Analysis failed.', updatedAt: Date.now() },
        }));
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 1200);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [analysisJob?.id, isPlanning, settings.pairingToken]);

  const runAnalysis = async () => {
    if (!content.trim() || project.assets.length === 0) return;
    updateProject(() => ({ script: content }));
    updateEngine(() => ({ status: 'checking', error: undefined, analysisJob: null, exportResult: null }));
    setUploadProgress(0);
    localEngine.setPairingToken(settings.pairingToken);
    const controller = new AbortController();
    requestController.current = controller;
    const uploadedIds: string[] = [];
    try {
      const health = await localEngine.health(controller.signal);
      updateEngine(() => ({ ...health, status: 'connected', lastCheckedAt: Date.now(), error: undefined }));
      const media: { id: string; assetId: string }[] = [];
      const uploadedMedia = { ...engine.uploadedMedia };
      for (const [index, asset] of project.assets.entries()) {
        const file = await getLocalMedia(asset.id);
        if (!file) throw new Error(`${asset.name} is missing from browser storage. Re-import it before analysis.`);
        const uploaded = await localEngine.uploadMedia(asset.id, file, {
          signal: controller.signal,
          onProgress: (assetProgress) => setUploadProgress((index + assetProgress) / project.assets.length),
        });
        uploadedMedia[asset.id] = uploaded.id;
        media.push(uploaded);
        uploadedIds.push(asset.id);
        setUploadProgress((index + 1) / project.assets.length);
      }
      updateEngine(() => ({ uploadedMedia }));
      const job = await localEngine.startAnalysis({ projectId: project.id, script: content, media });
      updateEngine(() => ({ analysisJob: { ...job, updatedAt: Date.now() } }));
    } catch (error) {
      if (controller.signal.aborted) {
        await Promise.all(uploadedIds.map((id) => localEngine.deleteUploadedMedia(id).catch(() => undefined)));
      }
      updateEngine(() => ({
        status: controller.signal.aborted ? 'connected' : 'disconnected',
        error: controller.signal.aborted ? 'Analysis setup cancelled. Partial local-engine uploads were removed.' : error instanceof Error ? error.message : 'Local analysis could not start.',
      }));
    } finally {
      setUploadProgress(0);
      requestController.current = null;
    }
  };

  const cancelAnalysis = async () => {
    if (requestController.current) {
      requestController.current.abort();
      return;
    }
    if (!analysisJob) return;
    localEngine.setPairingToken(settings.pairingToken);
    try {
      const job = await localEngine.cancelJob(analysisJob.id);
      updateEngine(() => ({ analysisJob: { ...job, updatedAt: Date.now() } }));
    } catch (error) {
      updateEngine(() => ({ error: error instanceof Error ? error.message : 'Could not cancel analysis.' }));
    }
  };

  const requestSuggestions = async () => {
    if (settings.privacyMode !== 'hybrid' || settings.modelProvider === 'none' || !consent) return;
    setAiBusy(true);
    setAiError('');
    try {
      const consentResponse = await fetch('/api/ai/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: settings.modelProvider, script: content, reviewed: true }),
      });
      const consentData = await consentResponse.json();
      if (!consentResponse.ok) throw new Error(consentData.error || 'Could not record payload approval.');
      const response = await fetch('/api/ai/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: settings.modelProvider,
          script: content,
          consentToken: consentData.consentToken,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Provider request failed.');
      setSuggestions(data);
      setReviewOpen(false);
      setConsent(false);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Provider unavailable. Continue locally.');
    } finally {
      setAiBusy(false);
    }
  };

  const handleSaveVariant = () => {
    if (!variantName.trim()) return;
    updateProject((current) => {
      const timelineStyleId = current.timeline
        .map((item) => current.takes.find((take) => take.id === item.takeId)?.edit?.styleProfileId)
        .find(Boolean);
      return {
        versions: [
          ...current.versions,
          {
            id: crypto.randomUUID(),
            name: variantName.trim(),
            timeline: current.timeline,
            createdAt: Date.now(),
            styleProfileId: timelineStyleId ?? settings.styleProfile,
          },
        ],
      };
    });
    setShowSaveVariantDialog(false);
    setVariantName('');
  };

  const handleLoadVariant = (versionId: string) => {
    const version = project.versions.find((item) => item.id === versionId);
    if (!version) return;
    updateProject(() => ({ timeline: version.timeline }));
    const versionStyleId = version.styleProfileId
      ?? version.timeline
        .map((item) => project.takes.find((take) => take.id === item.takeId)?.edit?.styleProfileId)
        .find(Boolean);
    if (versionStyleId) updateSettings(() => ({ styleProfile: versionStyleId }));
  };

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center px-6 justify-between bg-card shrink-0">
        <div className="flex items-center gap-3">
          <Type className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg text-foreground tracking-tight">Script Editor</h1>
          {isSaving ? (
            <Badge variant="secondary" className="ml-2 font-mono text-xs">Saving…</Badge>
          ) : (
            <div className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
              <Clock className="w-3 h-3" />
              Saved {lastSaved.toLocaleTimeString()}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Select value={settings.styleProfile} onValueChange={(styleProfile) => updateSettings(() => ({ styleProfile }))}>
            <SelectTrigger className="w-[200px] h-8 text-xs bg-background">
              <SelectValue placeholder="Select style…" />
            </SelectTrigger>
            <SelectContent>
              {allProfiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button data-testid="button-run-analysis" variant="outline" size="sm" onClick={() => void runAnalysis()} disabled={isPlanning || engine.status === 'checking' || !content.trim() || project.assets.length === 0} className="h-8 gap-2 group">
            {isPlanning ? <Clock className="w-4 h-4 animate-spin text-primary" /> : <Sparkles className="w-4 h-4 text-primary group-hover:animate-pulse" />}
            {isPlanning ? `${analysisJob?.stage ?? 'Analyzing'} · ${Math.round((analysisJob?.progress ?? 0) * 100)}%` : engine.status === 'checking' ? uploadProgress ? `Uploading · ${Math.round(uploadProgress * 100)}%` : 'Connecting…' : 'Analyze with local engine'}
          </Button>
          {settings.privacyMode === 'hybrid' && settings.modelProvider !== 'none' && (
            <Button size="sm" onClick={() => { setAiError(''); setReviewOpen(true); }} disabled={!content.trim()} className="h-8 gap-2">
              <Wand2 className="w-4 h-4" /> Ask {settings.modelProvider === 'gemini' ? 'Gemini' : 'OpenRouter'}
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col relative max-w-4xl mx-auto w-full p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium">Project script</p>
              <p className="text-xs text-muted-foreground mt-1">Use a new line for a beat, or brackets for visual cues.</p>
            </div>
            {planReady && (
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="gap-1.5 border-emerald-400/30 text-emerald-300"><CheckCircle2 className="w-3 h-3" /> Plan ready</Badge>
                <Button variant="secondary" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setShowSaveVariantDialog(true)}>
                  <Save className="w-3.5 h-3.5" /> Save Variant
                </Button>
              </div>
            )}
          </div>
          <div className="bg-card border border-border rounded-xl shadow-sm flex-1 flex flex-col overflow-hidden focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
            <Textarea
                data-testid="input-script"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste your video script, transcript, or outline here…"
              className="flex-1 border-0 rounded-none focus-visible:ring-0 resize-none p-6 text-base leading-relaxed font-sans text-foreground/90 bg-transparent"
            />
          </div>
        </div>

        <div className="w-80 border-l border-border bg-card flex flex-col shrink-0">
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Wand2 className="w-4 h-4 text-primary" /> Script Assistant</h3>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-6">
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Draft length</h4>
                <div className="text-2xl font-mono font-medium">{wordCount}</div>
                <p className="text-xs text-muted-foreground">Estimated speaking time: ~{Math.max(1, Math.round(wordCount / 2.5))} seconds</p>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Detected beats</h4>
                <div className="flex flex-wrap gap-1.5">
                  {tags.length > 0 ? tags.map((tag) => <Badge key={tag} variant="outline" className="bg-primary/5 border-primary/20 text-primary">{tag}</Badge>) : <span className="text-xs text-muted-foreground italic">Use [B-roll: subject] to mark visual cues.</span>}
                </div>
              </div>

              <div className="rounded-lg p-3 border border-primary/20 bg-primary/5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Footage is sent only to the engine at 127.0.0.1:4317. Analysis is unavailable unless that engine is running.
                  </p>
                </div>
              </div>

              <div data-testid="status-local-engine" className={`rounded-lg p-3 border ${engine.status === 'connected' ? 'border-emerald-400/30 bg-emerald-400/5' : engine.error ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-background'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">Local engine: {engine.status}</span>
                  {(isPlanning || engine.status === 'checking') && <Button data-testid="button-cancel-analysis" variant="ghost" size="sm" onClick={() => void cancelAnalysis()} className="h-6 px-2 text-xs text-destructive"><Square className="w-3 h-3 mr-1" /> Cancel</Button>}
                </div>
                {isPlanning && <div className="h-1.5 rounded bg-muted mt-3 overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${(analysisJob?.progress ?? 0) * 100}%` }} /></div>}
                {(analysisJob?.error || engine.error) && <p className="text-[11px] text-destructive mt-2 leading-relaxed">{analysisJob?.error || engine.error}</p>}
                {analysisJob?.status === 'cancelled' && <p className="text-[11px] text-muted-foreground mt-2">Analysis cancelled. No result was applied.</p>}
              </div>

              {project.transcript && (
                <div data-testid="text-transcript-summary" className="space-y-1">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Real transcript</h4>
                  <p className="text-xs text-muted-foreground">{project.transcript.words.length} timed words{project.transcript.language ? ` · ${project.transcript.language}` : ''}</p>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                  Plan Variants
                  <Badge variant="secondary" className="font-mono text-[10px]">{project.versions.length}</Badge>
                </h4>
                {project.versions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No comparison variants saved yet.</p>
                ) : (
                  <div className="space-y-2">
                    {project.versions.map((version) => (
                      <div key={version.id} className="p-3 bg-background border border-border rounded-lg group">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-1.5 font-medium text-sm"><GitBranch className="w-3.5 h-3.5 text-muted-foreground" />{version.name}</div>
                          <span className="text-[10px] text-muted-foreground">{new Date(version.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-xs text-muted-foreground">{version.timeline.length} clips</span>
                          <Button variant="secondary" size="sm" className="h-6 text-[10px] px-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleLoadVariant(version.id)}>Load variant</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plan preview</h4>
                <p className="text-xs text-muted-foreground">{cues.length} beats detected · {project.assets.length} local assets available.</p>
                {project.assets.length === 0 && (
                  <Link href="/assets"><Button variant="outline" size="sm" className="w-full mt-2">Import footage first</Button></Link>
                )}
              </div>

              {suggestions && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Approved text suggestions</h4>
                    {suggestions.fallback && <Badge variant="outline">Local fallback</Badge>}
                  </div>
                  {suggestions.message && <p className="text-xs text-amber-300">{suggestions.message}</p>}
                  <div>
                    <p className="text-xs font-medium mb-1">Hook options</p>
                    {suggestions.hooks.map((item) => <p key={item} className="text-xs text-muted-foreground mb-1">• {item}</p>)}
                  </div>
                  <div>
                    <p className="text-xs font-medium mb-1">B-roll ideas</p>
                    {suggestions.broll.map((item) => <p key={item} className="text-xs text-muted-foreground mb-1">• {item}</p>)}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{suggestions.usage.remaining} provider requests remain today.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      <Dialog open={showSaveVariantDialog} onOpenChange={setShowSaveVariantDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Comparison Variant</DialogTitle>
            <DialogDescription>Save the current local-engine timeline to compare editing styles later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="variant-name">Variant Name</Label>
              <Input id="variant-name" value={variantName} onChange={(event) => setVariantName(event.target.value)} placeholder="e.g. Fast Paced Version" autoFocus />
            </div>
            <div className="text-xs text-muted-foreground">This variant has {project.timeline.length} clips and uses the selected style.</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveVariantDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveVariant} disabled={!variantName.trim()}>Save Variant</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={(open) => { setReviewOpen(open); if (!open) setConsent(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Review exactly what leaves this device</DialogTitle>
            <DialogDescription>
              Only the text below goes to {settings.modelProvider}. No footage, audio, thumbnails, filenames, paths, durations, or asset metadata are included.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Approved payload · script text · {content.length.toLocaleString()} characters
            </p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">{content}</pre>
          </div>
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} />
            <span>I approve sending this exact script text once. This does not enable automatic uploads or future requests.</span>
          </label>
          {aiError && <p className="text-sm text-amber-300">{aiError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Keep local</Button>
            <Button onClick={() => void requestSuggestions()} disabled={!consent || aiBusy}>
              {aiBusy ? 'Sending approved text…' : 'Send once'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}