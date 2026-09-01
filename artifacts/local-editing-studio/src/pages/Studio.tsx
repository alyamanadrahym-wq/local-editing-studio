import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useStore, updateProject, type Take } from '@/lib/store';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import {
  Play,
  Pause,
  SkipBack,
  Plus,
  CheckCircle2,
  ListVideo,
  AlignLeft,
  SlidersHorizontal,
  Maximize2,
  MonitorPlay,
  Trash2,
  FileVideo,
  Sparkles,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${minutes.toString().padStart(2, '0')}:${remaining.toString().padStart(2, '0')}`;
}

function takeLabel(take: Take, index: number): string {
  const cue = take.notes.split('·').pop()?.trim();
  return cue ? `Beat ${index + 1}` : `Take ${take.id.slice(0, 4)}`;
}

export default function Studio() {
  const project = useStore((state) => state.project);
  const [selectedTakeId, setSelectedTakeId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const orderedTimeline = useMemo(() => [...project.timeline].sort((a, b) => a.order - b.order), [project.timeline]);
  const selectedTake = project.takes.find((take) => take.id === selectedTakeId)
    ?? project.takes.find((take) => take.id === orderedTimeline[0]?.takeId);
  const selectedAsset = project.assets.find((asset) => asset.id === selectedTake?.assetId);

  useEffect(() => {
    if (selectedTake && selectedTake.id !== selectedTakeId) setSelectedTakeId(selectedTake.id);
  }, [selectedTake, selectedTakeId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedTake) return;
    video.pause();
    setIsPlaying(false);
    video.currentTime = selectedTake.start;
    setCurrentTime(selectedTake.start);
  }, [selectedTake?.id, selectedTake?.start]);

  const selectTake = (take: Take) => {
    setSelectedTakeId(take.id);
    setIsPlaying(false);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = take.start;
      setCurrentTime(take.start);
    }
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || !selectedTake) return;
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
      return;
    }
    if (video.currentTime < selectedTake.start || video.currentTime >= selectedTake.end) video.currentTime = selectedTake.start;
    void video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  };

  const addToSequence = (take: Take) => {
    updateProject((current) => {
      if (current.timeline.some((item) => item.takeId === take.id)) {
        return { takes: current.takes.map((item) => item.id === take.id ? { ...item, selected: true } : item) };
      }
      return {
        takes: current.takes.map((item) => item.id === take.id ? { ...item, selected: true } : item),
        timeline: [...current.timeline, { id: crypto.randomUUID(), takeId: take.id, order: current.timeline.length }],
      };
    });
    setSelectedTakeId(take.id);
  };

  const removeFromSequence = (takeId: string) => {
    updateProject((current) => ({
      timeline: current.timeline
        .filter((item) => item.takeId !== takeId)
        .map((item, index) => ({ ...item, order: index })),
      takes: current.takes.map((take) => take.id === takeId ? { ...take, selected: false } : take),
    }));
  };

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center px-4 justify-between bg-card shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <input
            value={project.name}
            onChange={(event) => updateProject(() => ({ name: event.target.value }))}
            aria-label="Project name"
            className="font-semibold text-lg text-foreground tracking-tight bg-transparent border-0 outline-none min-w-0 w-48 focus:ring-1 focus:ring-primary/50 rounded px-1"
          />
          <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 rounded-full font-mono text-xs shrink-0">
            {project.timeline.length ? `${project.timeline.length} clips` : 'Draft'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden sm:flex gap-1.5 border-emerald-400/30 text-emerald-300">
            <CheckCircle2 className="w-3 h-3" /> Local only
          </Badge>
          <Link href="/export">
            <Button size="sm" className="h-8 bg-primary text-primary-foreground hover:bg-primary/90">
              Export plan
            </Button>
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={25} minSize={20} maxSize={40} className="bg-card">
            <div className="h-full flex flex-col">
              <div className="h-10 border-b border-border flex items-center px-4 gap-2 shrink-0">
                <AlignLeft className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Script & Plan</span>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-6">
                  {project.script ? (
                    <div className="space-y-3">
                      {project.script.split(/\n+/).filter(Boolean).map((paragraph, index) => (
                        <div key={`${paragraph}-${index}`} className="flex gap-3 text-sm">
                          <span className="text-[10px] font-mono text-primary/70 pt-1">{String(index + 1).padStart(2, '0')}</span>
                          <p className="text-muted-foreground hover:text-foreground transition-colors">{paragraph}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-10 px-4 border border-dashed border-border rounded-lg bg-background/50">
                      <p className="text-sm text-muted-foreground mb-4">Add a script to start planning your cut.</p>
                      <Link href="/script"><Button variant="secondary" size="sm">Open script editor</Button></Link>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Timeline Plan</h3>
                      <span className="text-[10px] font-mono text-muted-foreground">{orderedTimeline.length} clips</span>
                    </div>
                    {orderedTimeline.length > 0 ? (
                      <div className="space-y-1">
                        {orderedTimeline.map((item, index) => {
                          const take = project.takes.find((candidate) => candidate.id === item.takeId);
                          return take ? (
                            <button key={item.id} onClick={() => selectTake(take)} className="w-full text-left flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors border border-transparent hover:border-border">
                              <span className="text-xs font-mono text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                              <div className="flex-1 truncate text-sm">{takeLabel(take, index)}</div>
                              <span className="text-[10px] font-mono text-muted-foreground">{formatTime(take.end - take.start)}</span>
                            </button>
                          ) : null;
                        })}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground/60 italic">Build a plan from the Script tab.</div>
                    )}
                  </div>
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full flex flex-col bg-black relative">
              <div className="flex-1 flex items-center justify-center relative group min-h-0">
                {selectedAsset?.type === 'video' ? (
                  <video
                    ref={videoRef}
                    src={selectedAsset.url}
                    className="max-h-full max-w-full object-contain"
                    playsInline
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onTimeUpdate={(event) => {
                      const time = event.currentTarget.currentTime;
                      setCurrentTime(time);
                      if (selectedTake && time >= selectedTake.end) {
                        event.currentTarget.pause();
                        event.currentTarget.currentTime = selectedTake.start;
                      }
                    }}
                  />
                ) : selectedAsset ? (
                  <div className="text-white/60 text-sm flex flex-col items-center gap-3"><FileVideo className="w-10 h-10 text-white/20" />{selectedAsset.name} is not a video preview.</div>
                ) : (
                  <div className="text-muted-foreground text-sm flex flex-col items-center gap-3">
                    <MonitorPlay className="w-10 h-10 opacity-40" />
                    Import footage and build a local plan to preview it.
                    <Link href="/assets"><Button variant="outline" size="sm">Open assets</Button></Link>
                  </div>
                )}

                {selectedTake && selectedAsset?.type === 'video' && (
                  <div className="absolute top-4 left-4 rounded-md bg-black/60 border border-white/10 px-2.5 py-1.5 text-[11px] font-mono text-white/80">
                    {formatTime(currentTime)} / {formatTime(selectedTake.end)}
                  </div>
                )}

                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 backdrop-blur-md border border-white/10 rounded-full px-4 py-2 flex items-center gap-4 shadow-xl">
                  <Button variant="ghost" size="icon" onClick={() => selectTake(selectedTake ?? project.takes[0])} disabled={!selectedTake} className="h-8 w-8 rounded-full text-white hover:bg-white/20 hover:text-white border-0">
                    <SkipBack className="w-4 h-4 fill-current" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={togglePlayback} disabled={!selectedAsset || selectedAsset.type !== 'video'} className="h-10 w-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 transition-all border-0">
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => videoRef.current?.requestFullscreen()} disabled={!selectedAsset} className="h-8 w-8 rounded-full text-white hover:bg-white/20 hover:text-white border-0">
                    <Maximize2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="h-48 border-t border-white/10 bg-zinc-950 flex flex-col shrink-0">
                <div className="h-8 border-b border-white/5 flex items-center px-4 justify-between bg-zinc-900/50">
                  <div className="text-xs font-medium text-zinc-400 flex items-center gap-2"><ListVideo className="w-3 h-3" /> Sequence</div>
                  <div className="text-xs font-mono text-zinc-500">{formatTime(orderedTimeline.reduce((sum, item) => { const take = project.takes.find((candidate) => candidate.id === item.takeId); return sum + (take ? take.end - take.start : 0); }, 0))}</div>
                </div>
                <div className="flex-1 relative overflow-x-auto p-4 flex items-center gap-2">
                  {orderedTimeline.length > 0 ? orderedTimeline.map((item, index) => {
                    const take = project.takes.find((candidate) => candidate.id === item.takeId);
                    if (!take) return null;
                    return (
                      <div key={item.id} className={`relative h-16 min-w-32 bg-zinc-800 border rounded p-2 cursor-pointer transition-colors group ${selectedTake?.id === take.id ? 'border-primary' : 'border-zinc-700 hover:border-primary/60'}`} onClick={() => selectTake(take)}>
                        <div className="text-[10px] font-mono text-zinc-400 truncate group-hover:text-primary transition-colors">{String(index + 1).padStart(2, '0')} · {takeLabel(take, index)}</div>
                        <div className="absolute bottom-2 left-2 right-2 h-1 bg-zinc-700 rounded overflow-hidden"><div className="h-full bg-primary/70" style={{ width: `${Math.min(100, take.rating * 20)}%` }} /></div>
                        <button aria-label={`Remove clip ${index + 1}`} onClick={(event) => { event.stopPropagation(); removeFromSequence(take.id); }} className="absolute -top-2 -right-2 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-zinc-300 hover:bg-destructive hover:text-white"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    );
                  }) : <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-zinc-600 font-medium gap-2"><ListVideo className="w-5 h-5 opacity-50" />Use takes from the inspector to build your sequence</div>}
                </div>
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={25} minSize={20} maxSize={40} className="bg-card">
            <div className="h-full flex flex-col">
              <div className="h-10 border-b border-border flex items-center px-4 gap-2 shrink-0"><SlidersHorizontal className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-medium">Takes & Inspector</span></div>
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-5">
                  {project.takes.length > 0 ? (
                    <div className="grid gap-3">
                      {project.takes.map((take, index) => (
                        <div key={take.id} onClick={() => selectTake(take)} className={`p-3 rounded-lg border cursor-pointer transition-all ${selectedTake?.id === take.id ? 'border-primary bg-primary/5 shadow-[0_0_15px_rgba(255,93,0,0.1)]' : 'border-border bg-background hover:border-muted-foreground/50'}`}>
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-sm font-medium">Beat {index + 1}</span>
                            <div className="flex gap-1" aria-label={`${take.rating} out of 5`}>
                              {Array.from({ length: 5 }).map((_, star) => <div key={star} className={`w-1.5 h-1.5 rounded-full ${star < take.rating ? 'bg-primary' : 'bg-muted'}`} />)}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground line-clamp-2 mb-2">{take.notes}</div>
                          <div className="flex justify-between items-center text-[10px] font-mono text-muted-foreground/80">
                            <span>{formatTime(take.start)} – {formatTime(take.end)}</span>
                            {take.selected ? <Badge variant="secondary" className="text-[9px] h-4 px-1 border-primary/20 text-primary">IN SEQUENCE</Badge> : <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); addToSequence(take); }} className="h-5 px-1.5 text-[10px] gap-1 text-primary"><Plus className="w-3 h-3" /> Use take</Button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-10 px-4 border border-dashed border-border rounded-lg bg-background/50">
                      <Sparkles className="w-7 h-7 text-primary/60 mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground mb-4">No local edit plan yet.</p>
                      <Link href="/script"><Button variant="secondary" size="sm">Open script editor</Button></Link>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}