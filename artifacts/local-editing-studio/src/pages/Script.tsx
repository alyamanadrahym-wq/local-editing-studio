import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useStore, updateProject, updateSettings, type CustomStyleProfile, type Take, type TimelineItem } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Type, Sparkles, Clock, Wand2, AlertCircle, CheckCircle2, History, GitBranch, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

function makeId(): string {
  return crypto.randomUUID();
}

function extractCues(script: string): string[] {
  return script
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?؟。])\s+/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function normalizeCue(cue: string): string {
  return cue
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLocalPlan(
  script: string, 
  assetIds: string[], 
  durations: Map<string, number | undefined>,
  traits: CustomStyleProfile['traits'],
  styleProfileId: string
): {
  takes: Take[];
  timeline: TimelineItem[];
} {
  const cues = extractCues(script);
  const uniqueCues = new Map<string, { text: string; repeats: number }>();
  for (const cue of cues) {
    const key = normalizeCue(cue);
    const existing = uniqueCues.get(key);
    uniqueCues.set(key, existing ? { ...existing, repeats: existing.repeats + 1 } : { text: cue, repeats: 1 });
  }

  const takes: Take[] = [];
  const timeline: TimelineItem[] = [];
  Array.from(uniqueCues.values()).forEach(({ text, repeats }, index) => {
    const useBroll = traits.bRollDensity === 'High'
      ? index % 2 === 1
      : traits.bRollDensity === 'Moderate' && index > 0 && index % 3 === 0;
    const assetId = useBroll && assetIds.length > 1 ? assetIds[(index % (assetIds.length - 1)) + 1] : assetIds[0];
    const duration = durations.get(assetId) ?? 12;
    
    let clipLength = Math.max(4, Math.min(12, duration));
    if (traits.cuttingPace === 'Fast') {
      clipLength = Math.max(2, Math.min(6, duration));
    } else if (traits.cuttingPace === 'Slow') {
      clipLength = Math.max(6, Math.min(15, duration));
    }

    const start = Math.min(index * 4, Math.max(0, duration - clipLength));
    const end = Math.min(duration, start + clipLength);
    const take: Take = {
      id: makeId(),
      assetId,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      notes: `${repeats > 1 ? `Repeated cue merged ${repeats} times` : 'Available footage window'} · “${text.slice(0, 72)}” · ${traits.cuttingPace} pace · ${traits.bRollDensity} B-roll · captions ${traits.captions ? 'on' : 'off'} · zoom ${traits.zoom ? 'on' : 'off'}`,
      selected: true,
      rating: 4,
      edit: {
        styleProfileId,
        role: useBroll ? 'b-roll' : 'a-roll',
        caption: traits.captions ? text : null,
        zoomScale: traits.zoom ? Number((1.04 + (index % 3) * 0.03).toFixed(2)) : 1,
        bRollDensity: traits.bRollDensity,
      },
    };
    takes.push(take);
    timeline.push({ id: makeId(), takeId: take.id, order: index });
  });

  return { takes, timeline };
}

export default function Script() {
  const project = useStore((s) => s.project);
  const settings = useStore((s) => s.settings);
  const [content, setContent] = useState(project.script);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planReady, setPlanReady] = useState(project.timeline.length > 0);
  const [lastSaved, setLastSaved] = useState<Date>(new Date());
  
  const [showSaveVariantDialog, setShowSaveVariantDialog] = useState(false);
  const [variantName, setVariantName] = useState("");
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

  const runAnalysis = () => {
    if (!content.trim() || project.assets.length === 0) return;
    setIsPlanning(true);
    window.setTimeout(() => {
      const durations = new Map(project.assets.map((asset) => [asset.id, asset.duration]));
      const builtInTraits: Record<string, CustomStyleProfile['traits']> = {
        cinematic: { cuttingPace: 'Slow', bRollDensity: 'Low', captions: false, zoom: false },
        'fast-social': { cuttingPace: 'Fast', bRollDensity: 'High', captions: true, zoom: true },
        documentary: { cuttingPace: 'Moderate', bRollDensity: 'High', captions: false, zoom: false },
        corporate: { cuttingPace: 'Moderate', bRollDensity: 'Moderate', captions: true, zoom: false },
      };
      const activeTraits = settings.customProfiles.find((profile) => profile.id === settings.styleProfile)?.traits
        ?? builtInTraits[settings.styleProfile]
        ?? builtInTraits.cinematic;
      const plan = buildLocalPlan(content, project.assets.map((asset) => asset.id), durations, activeTraits, settings.styleProfile);
      
      updateProject((current) => ({ 
        takes: [...current.takes, ...plan.takes], 
        timeline: plan.timeline 
      }));
      
      setIsPlanning(false);
      setPlanReady(true);
    }, 400);
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
          id: makeId(),
          name: variantName,
          timeline: current.timeline,
          createdAt: Date.now(),
          styleProfileId: timelineStyleId ?? settings.styleProfile,
          }
        ]
      };
    });
    
    setShowSaveVariantDialog(false);
    setVariantName("");
  };

  const handleLoadVariant = (versionId: string) => {
    const version = project.versions.find(v => v.id === versionId);
    if (!version) return;
    
    updateProject(() => ({
      timeline: version.timeline
    }));
    const versionStyleId = version.styleProfileId
      ?? version.timeline.map((item) => project.takes.find((take) => take.id === item.takeId)?.edit?.styleProfileId).find(Boolean);
    if (versionStyleId) {
      updateSettings(() => ({ styleProfile: versionStyleId }));
    }
  };

  const handleProfileChange = (val: string) => {
    updateSettings(() => ({ styleProfile: val }));
  };

  const allProfiles = [
    { id: 'cinematic', name: 'Cinematic Narrative' },
    { id: 'fast-social', name: 'Fast Social (TikTok/Reels)' },
    { id: 'documentary', name: 'Documentary' },
    { id: 'corporate', name: 'Corporate Clean' },
    ...settings.customProfiles
  ];

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
          <Select value={settings.styleProfile} onValueChange={handleProfileChange}>
            <SelectTrigger className="w-[200px] h-8 text-xs bg-background">
              <SelectValue placeholder="Select style..." />
            </SelectTrigger>
            <SelectContent>
              {allProfiles.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" onClick={runAnalysis} disabled={isPlanning || !content.trim() || project.assets.length === 0} className="h-8 gap-2 group">
            {isPlanning ? <Clock className="w-4 h-4 animate-spin text-primary" /> : <Sparkles className="w-4 h-4 text-primary group-hover:animate-pulse" />}
            {isPlanning ? 'Building plan…' : 'Build Plan'}
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
                <Badge variant="outline" className="gap-1.5 border-emerald-400/30 text-emerald-300">
                  <CheckCircle2 className="w-3 h-3" /> Plan ready
                </Badge>
                <Button 
                  variant="secondary" 
                  size="sm" 
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setShowSaveVariantDialog(true)}
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Variant
                </Button>
              </div>
            )}
          </div>
          <div className="bg-card border border-border rounded-xl shadow-sm flex-1 flex flex-col overflow-hidden focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
            <Textarea
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
                    This first pass runs locally and plans around your script and imported media. It does not upload your footage or claim a cloud transcription happened.
                  </p>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                  Plan Variants
                  <Badge variant="secondary" className="font-mono text-[10px]">{project.versions.length}</Badge>
                </h4>
                
                {project.versions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No comparison variants saved yet. Build a plan and save it to compare different styles.</p>
                ) : (
                  <div className="space-y-2 mt-2">
                    {project.versions.map(version => (
                      <div key={version.id} className="p-3 bg-background border border-border rounded-lg group">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-1.5 font-medium text-sm">
                            <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
                            {version.name}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(version.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-xs text-muted-foreground">{version.timeline.length} clips</span>
                          <Button 
                            variant="secondary" 
                            size="sm" 
                            className="h-6 text-[10px] px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleLoadVariant(version.id)}
                          >
                            Load variant
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="pt-4">
                  <p className="text-xs text-muted-foreground mb-2">{cues.length} beats detected · {project.assets.length} local assets available.</p>
                  {project.assets.length === 0 && (
                    <Link href="/assets"><Button variant="outline" size="sm" className="w-full">Import footage first</Button></Link>
                  )}
                </div>
              </div>
              {aiError && (
                <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">
                  {aiError}
                </div>
              )}
              {suggestions && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Optional AI suggestions</h4>
                  {suggestions.fallback && (
                    <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">
                      {suggestions.message}
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-medium mb-1">Hooks</p>
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
            <DialogDescription>
              Save the current timeline to compare different editing styles later.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="variant-name">Variant Name</Label>
              <Input 
                id="variant-name" 
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
                placeholder="e.g. Fast Paced Version"
                autoFocus
              />
            </div>
            <div className="text-xs text-muted-foreground">
              This variant has {project.timeline.length} clips and is locally assembled.
            </div>
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