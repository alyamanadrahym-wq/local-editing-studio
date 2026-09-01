import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useStore, updateProject, type Take } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Type, Sparkles, Clock, Wand2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

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

function buildLocalPlan(script: string, assetIds: string[], durations: Map<string, number | undefined>): {
  takes: Take[];
  timeline: { id: string; takeId: string; order: number }[];
} {
  const cues = extractCues(script);
  const uniqueCues = new Map<string, { text: string; repeats: number }>();
  for (const cue of cues) {
    const key = normalizeCue(cue);
    const existing = uniqueCues.get(key);
    uniqueCues.set(key, existing ? { ...existing, repeats: existing.repeats + 1 } : { text: cue, repeats: 1 });
  }

  const takes: Take[] = [];
  const timeline: { id: string; takeId: string; order: number }[] = [];
  Array.from(uniqueCues.values()).forEach(({ text, repeats }, index) => {
    const assetId = assetIds[index % assetIds.length];
    const duration = durations.get(assetId) ?? 12;
    const clipLength = Math.max(4, Math.min(12, duration));
    const start = Math.min(index * 4, Math.max(0, duration - clipLength));
    const end = Math.min(duration, start + clipLength);
    const take: Take = {
      id: makeId(),
      assetId,
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      notes: repeats > 1
        ? `Repeated cue merged ${repeats} times · “${text.slice(0, 72)}”`
        : `Available footage window · “${text.slice(0, 72)}”`,
      selected: true,
      rating: 4,
    };
    takes.push(take);
    timeline.push({ id: makeId(), takeId: take.id, order: index });
  });

  return { takes, timeline };
}

export default function Script() {
  const project = useStore((s) => s.project);
  const [content, setContent] = useState(project.script);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planReady, setPlanReady] = useState(project.timeline.length > 0);
  const [lastSaved, setLastSaved] = useState<Date>(new Date());
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
      const plan = buildLocalPlan(content, project.assets.map((asset) => asset.id), durations);
      updateProject((current) => ({ takes: plan.takes, timeline: plan.timeline }));
      setIsPlanning(false);
      setPlanReady(true);
    }, 250);
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
        <Button variant="outline" size="sm" onClick={runAnalysis} disabled={isPlanning || !content.trim() || project.assets.length === 0} className="h-8 gap-2 group">
          {isPlanning ? <Clock className="w-4 h-4 animate-spin text-primary" /> : <Sparkles className="w-4 h-4 text-primary group-hover:animate-pulse" />}
          {isPlanning ? 'Building local plan…' : 'Build local edit plan'}
        </Button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col relative max-w-4xl mx-auto w-full p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium">Project script</p>
              <p className="text-xs text-muted-foreground mt-1">Use a new line for a beat, or brackets for visual cues.</p>
            </div>
            {planReady && <Badge variant="outline" className="gap-1.5 border-emerald-400/30 text-emerald-300"><CheckCircle2 className="w-3 h-3" /> Plan ready</Badge>}
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
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Plan preview</h4>
                <p className="text-xs text-muted-foreground">{cues.length} beats detected · {project.assets.length} local assets available.</p>
                {project.assets.length === 0 && (
                  <Link href="/assets"><Button variant="outline" size="sm" className="w-full mt-2">Import footage first</Button></Link>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}