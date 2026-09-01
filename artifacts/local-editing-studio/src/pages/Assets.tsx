import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useStore, updateProject, type AssetItem } from '@/lib/store';
import { deleteLocalMedia, saveLocalMedia } from '@/lib/local-media';
import { Button } from '@/components/ui/button';
import {
  FolderOpen,
  Plus,
  FileVideo,
  FileAudio,
  Image as ImageIcon,
  Trash2,
  Clock,
  Calendar,
  HardDrive,
  UploadCloud,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

function getAssetType(file: File): AssetItem['type'] | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return null;
}

function readDuration(file: File): Promise<number | undefined> {
  if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(element.duration) ? element.duration : undefined);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    element.src = url;
  });
}

function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Assets() {
  const project = useStore((s) => s.project);
  const [dragActive, setDragActive] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const importFiles = async (files: FileList | File[]) => {
    const accepted = Array.from(files).filter((file) => getAssetType(file));
    if (accepted.length === 0) return;
    setIsImporting(true);
    const imported: AssetItem[] = [];

    for (const file of accepted) {
      const type = getAssetType(file);
      if (!type) continue;
      const id = crypto.randomUUID();
      const url = URL.createObjectURL(file);
      const duration = await readDuration(file);
      await saveLocalMedia(id, file).catch(() => undefined);
      imported.push({
        id,
        name: file.name,
        type,
        url,
        duration,
        size: file.size,
        mimeType: file.type,
        addedAt: Date.now(),
      });
    }

    updateProject((current) => ({ assets: [...current.assets, ...imported] }));
    setIsImporting(false);
  };

  const removeAsset = (asset: AssetItem) => {
    URL.revokeObjectURL(asset.url);
    void deleteLocalMedia(asset.id).catch(() => undefined);
    updateProject((current) => ({
      assets: current.assets.filter((item) => item.id !== asset.id),
      takes: current.takes.filter((take) => take.assetId !== asset.id),
      timeline: current.timeline.filter((item) => current.takes.find((take) => take.id === item.takeId)?.assetId !== asset.id),
    }));
  };

  const totalBytes = project.assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0);
  const videoCount = project.assets.filter((asset) => asset.type === 'video').length;
  const audioCount = project.assets.filter((asset) => asset.type === 'audio').length;
  const imageCount = project.assets.filter((asset) => asset.type === 'image').length;

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="video/*,audio/*,image/*"
        multiple
        onChange={(event) => {
          if (event.target.files) void importFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <header className="h-14 border-b border-border flex items-center px-6 justify-between bg-card shrink-0">
        <div className="flex items-center gap-3">
          <FolderOpen className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg text-foreground tracking-tight">Project Assets</h1>
          <Badge variant="secondary" className="ml-2 font-mono">{project.assets.length}</Badge>
        </div>
        <Button
          onClick={() => inputRef.current?.click()}
          size="sm"
          disabled={isImporting}
          className="h-8 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="w-4 h-4" />
          {isImporting ? 'Importing…' : 'Import Media'}
        </Button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col relative">
          <ScrollArea className="flex-1 p-6">
            {project.assets.length === 0 ? (
              <div
                className={`h-72 border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-colors ${
                  dragActive ? 'border-primary bg-primary/5' : 'border-border bg-card/30'
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  void importFiles(event.dataTransfer.files);
                }}
              >
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <UploadCloud className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-sm font-semibold mb-1">Drop your footage here</h3>
                <p className="text-xs text-muted-foreground mb-5">Video, audio, and image files stay on this device.</p>
                <Button variant="outline" onClick={() => inputRef.current?.click()} className="gap-2">
                  <FolderOpen className="w-4 h-4" />
                  Browse files
                </Button>
              </div>
            ) : (
              <div
                className={`min-h-full rounded-xl transition-colors ${dragActive ? 'ring-2 ring-primary ring-offset-4 ring-offset-background' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  void importFiles(event.dataTransfer.files);
                }}
              >
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-sm font-medium">Local media bin</p>
                    <p className="text-xs text-muted-foreground mt-1">Drop more files anywhere in this area.</p>
                  </div>
                  <div className="flex gap-2">
                    <Link href="/styles">
                      <Button variant="outline" size="sm" className="gap-2">
                        Clone a Style
                      </Button>
                    </Link>
                    <Link href="/script">
                      <Button variant="outline" size="sm" className="gap-2">
                        <Plus className="w-3.5 h-3.5" />
                        Add a script
                      </Button>
                    </Link>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {project.assets.map((asset) => (
                    <div key={asset.id} className="group relative border border-border bg-card rounded-xl overflow-hidden hover:border-primary/50 transition-all hover:shadow-md hover:shadow-primary/5">
                      <div className="aspect-video bg-zinc-900 relative flex items-center justify-center overflow-hidden">
                        {asset.type === 'video' && (
                          <video src={asset.url} muted preload="metadata" className="h-full w-full object-cover opacity-80" />
                        )}
                        {asset.type === 'image' && (
                          <img src={asset.url} alt="" className="h-full w-full object-cover opacity-80" />
                        )}
                        {asset.type === 'audio' && <FileAudio className="w-8 h-8 text-zinc-700" />}
                        <div className="absolute top-2 left-2 bg-black/65 backdrop-blur text-white text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded">
                          {asset.type}
                        </div>
                        {asset.duration && (
                          <div className="absolute bottom-2 right-2 bg-black/65 backdrop-blur text-white text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(asset.duration)}
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate text-foreground group-hover:text-primary transition-colors" title={asset.name}>
                              {asset.name}
                            </p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <Calendar className="w-3 h-3" />
                              {formatDate(asset.addedAt)}
                              {asset.size ? <span>· {formatBytes(asset.size)}</span> : null}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${asset.name}`}
                            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                            onClick={() => removeAsset(asset)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="w-72 border-l border-border bg-card flex flex-col shrink-0">
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-semibold">Local Storage</h3>
            <p className="text-xs text-muted-foreground mt-1">No cloud upload is used.</p>
          </div>
          <div className="p-4 space-y-5">
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5" /> Imported size</span>
                <span className="font-mono font-medium">{formatBytes(totalBytes)}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary w-1/3 rounded-full" />
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">Media bytes are kept in this browser’s local storage and can be cleared from Settings.</p>
            </div>

            <div className="pt-4 border-t border-border space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Asset Types</h4>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between"><span className="flex items-center gap-2"><FileVideo className="w-3.5 h-3.5 text-primary" /> Video</span><span className="font-mono">{videoCount}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-2"><FileAudio className="w-3.5 h-3.5 text-blue-400" /> Audio</span><span className="font-mono">{audioCount}</span></div>
                <div className="flex items-center justify-between"><span className="flex items-center gap-2"><ImageIcon className="w-3.5 h-3.5 text-violet-400" /> Images</span><span className="font-mono">{imageCount}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}