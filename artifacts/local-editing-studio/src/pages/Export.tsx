import React from 'react';
import { useStore, updateProject, updateSettings, type Take, type TimelineItem } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { MonitorPlay, Download, History, Clock, FileJson2, Captions, RotateCcw, ShieldCheck } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
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
  const { project, settings } = useStore();
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
      },
    };
    downloadFile(`${project.name || 'edit-plan'}.json`, JSON.stringify(manifest, null, 2), 'application/json');
  };

  const exportCaptions = () => {
    downloadFile(`${project.name || 'captions'}.srt`, createDraftSrt(project.takes, project.timeline), 'application/x-subrip');
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
              Export a portable cut manifest for the desktop render engine and a draft caption file. No media bytes leave this browser.
            </p>

            <div className="grid grid-cols-3 gap-3 mb-7">
              <div className="rounded-lg border border-border bg-background p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Clips</p><p className="text-lg font-mono mt-1">{orderedTimeline.length}</p></div>
              <div className="rounded-lg border border-border bg-background p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration</p><p className="text-lg font-mono mt-1">{Math.round(totalDuration)}s</p></div>
              <div className="rounded-lg border border-border bg-background p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Style</p><p className="text-sm font-medium mt-1 truncate">{settings.styleProfile}</p></div>
            </div>

            <div className="flex flex-col gap-3">
              <Button onClick={exportPlan} disabled={orderedTimeline.length === 0} className="w-full h-12 text-base font-semibold bg-primary text-primary-foreground hover:bg-primary/90 gap-2">
                <Download className="w-5 h-5" /> Download edit plan
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