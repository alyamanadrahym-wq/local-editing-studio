import React, { useRef, useState } from 'react';
import { useStore, updateSettings, type CustomStyleProfile } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { LayoutTemplate, CheckCircle2, Upload, Video, Info, Settings2, Trash2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const defaultProfiles = [
  {
    id: 'cinematic',
    name: 'Cinematic Narrative',
    description: 'Paces edits based on dialogue pauses. Prefers longer takes, slow pacing, and favors stabilized shots.',
    tags: ['Slow', 'Dialogue-driven', 'A-Roll focus']
  },
  {
    id: 'fast-social',
    name: 'Fast Social (TikTok/Reels)',
    description: 'Aggressive jump cuts cutting out all dead air. Frequent zooming and favors energetic takes.',
    tags: ['Fast', 'Jump cuts', 'High energy']
  },
  {
    id: 'documentary',
    name: 'Documentary',
    description: 'Balances interview A-Roll with frequent B-Roll inserts. Retains natural pauses for emotional impact.',
    tags: ['Balanced', 'B-Roll heavy', 'Natural']
  },
  {
    id: 'corporate',
    name: 'Corporate Clean',
    description: 'Straightforward, safe edits. Smooth transitions, standard pacing, avoids shaky footage.',
    tags: ['Conservative', 'Clean', 'Professional']
  }
];

function readDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement('video');
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

function analyzeVideoLocally(file: File, duration?: number): CustomStyleProfile['traits'] {
  const sizeMb = file.size / (1024 * 1024);
  const isShort = duration && duration < 60;
  const isLarge = sizeMb > 100;
  
  return {
    cuttingPace: isShort ? 'Fast' : (isLarge ? 'Slow' : 'Moderate'),
    bRollDensity: isLarge ? 'High' : 'Moderate',
    captions: !!isShort,
    zoom: !!isShort,
  };
}

export default function StyleProfiles() {
  const settings = useStore((s) => s.settings);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [draftProfile, setDraftProfile] = useState<{ name: string; sourceCount: number; traits: CustomStyleProfile['traits'] } | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    setIsAnalyzing(true);
    const analyses = await Promise.all(files.map(async (file) => {
      const duration = await readDuration(file);
      return analyzeVideoLocally(file, duration);
    }));
    const rank = ['Slow', 'Moderate', 'Fast'];
    const densityRank = ['Low', 'Moderate', 'High'];
    const traits: CustomStyleProfile['traits'] = {
      cuttingPace: rank[Math.round(analyses.reduce((sum, item) => sum + rank.indexOf(item.cuttingPace), 0) / analyses.length)],
      bRollDensity: densityRank[Math.round(analyses.reduce((sum, item) => sum + densityRank.indexOf(item.bRollDensity), 0) / analyses.length)],
      captions: analyses.filter((item) => item.captions).length >= analyses.length / 2,
      zoom: analyses.filter((item) => item.zoom).length >= analyses.length / 2,
    };
    
    setDraftProfile({
      name: files.length === 1 ? files[0].name.replace(/\.[^/.]+$/, "") + " Style" : `My ${files.length}-video Style`,
      sourceCount: files.length,
      traits
    });
    
    setIsAnalyzing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = () => {
    if (!draftProfile) return;
    
    const newProfile: CustomStyleProfile = {
      id: crypto.randomUUID(),
      name: draftProfile.name || 'Untitled Style',
      description: 'Custom style inferred locally from reference video metadata.',
      tags: ['Custom', draftProfile.traits.cuttingPace + ' Pace', draftProfile.traits.bRollDensity + ' B-Roll'],
      traits: draftProfile.traits
    };

    updateSettings((s) => ({
      customProfiles: [...s.customProfiles, newProfile],
      styleProfile: newProfile.id
    }));
    
    setDraftProfile(null);
  };

  const deleteProfile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    updateSettings((s) => {
      const remaining = s.customProfiles.filter(p => p.id !== id);
      return {
        customProfiles: remaining,
        styleProfile: s.styleProfile === id ? 'cinematic' : s.styleProfile
      };
    });
  };

  const allProfiles = [
    ...defaultProfiles.map(p => ({ ...p, isCustom: false, traits: null })),
    ...settings.customProfiles.map(p => ({
      ...p,
      isCustom: true
    }))
  ];

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <input
        type="file"
        ref={fileInputRef}
        accept="video/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      
      <header className="h-14 border-b border-border flex items-center px-6 justify-between bg-card shrink-0">
        <div className="flex items-center gap-3">
          <LayoutTemplate className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg text-foreground tracking-tight">Style Profiles</h1>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="max-w-5xl mx-auto w-full p-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold mb-2">Edit Directives</h2>
              <p className="text-muted-foreground">
                Style profiles instruct the local AI on how to assemble your timeline. 
                The system will prioritize takes and set pacing based on the active profile.
              </p>
            </div>
            
            <div className="bg-card border border-border p-4 rounded-xl shadow-sm flex flex-col gap-3 min-w-[300px]">
              <div className="flex items-start gap-3">
                <Video className="w-5 h-5 text-primary mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold">Clone a Style</h3>
                  <p className="text-xs text-muted-foreground mt-1">Analyze a local video to infer its editing traits. No cloud upload required.</p>
                </div>
              </div>
              <Button 
                onClick={() => fileInputRef.current?.click()} 
                disabled={isAnalyzing}
                className="w-full gap-2 mt-1"
                variant="secondary"
              >
                {isAnalyzing ? (
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    Analyzing locally...
                  </div>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Select Reference Videos
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {allProfiles.map(profile => {
              const isActive = settings.styleProfile === profile.id;
              const isCustom = 'isCustom' in profile && profile.isCustom;
              
              return (
                <div 
                  key={profile.id}
                  onClick={() => updateSettings(s => ({ styleProfile: profile.id }))}
                  className={`relative p-6 rounded-xl border-2 cursor-pointer transition-all flex flex-col ${
                    isActive 
                      ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10' 
                      : 'border-border bg-card hover:border-muted-foreground/50 hover:bg-accent/50'
                  }`}
                >
                  {isActive && (
                    <div className="absolute top-4 right-4">
                      <CheckCircle2 className="w-5 h-5 text-primary" />
                    </div>
                  )}
                  {isCustom && !isActive && (
                    <div className="absolute top-4 right-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => deleteProfile(profile.id, e)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-foreground pr-8">{profile.name}</h3>
                    {isCustom && <Badge variant="secondary" className="text-[10px]">Custom</Badge>}
                  </div>
                  
                  <p className="text-sm text-muted-foreground mb-6 line-clamp-2 h-10">
                    {profile.description}
                  </p>
                  
                  {isCustom && profile.traits && (
                    <div className="grid grid-cols-2 gap-2 mb-4 p-3 bg-background/50 rounded-lg border border-border/50 text-xs">
                      <div className="flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5 text-muted-foreground"/> <span className="text-muted-foreground">Pace:</span> <span className="font-medium">{profile.traits.cuttingPace}</span></div>
                      <div className="flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5 text-muted-foreground"/> <span className="text-muted-foreground">B-Roll:</span> <span className="font-medium">{profile.traits.bRollDensity}</span></div>
                      <div className="flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5 text-muted-foreground"/> <span className="text-muted-foreground">Captions:</span> <span className="font-medium">{profile.traits.captions ? 'Yes' : 'No'}</span></div>
                      <div className="flex items-center gap-1.5"><Settings2 className="w-3.5 h-3.5 text-muted-foreground"/> <span className="text-muted-foreground">Zoom:</span> <span className="font-medium">{profile.traits.zoom ? 'Yes' : 'No'}</span></div>
                    </div>
                  )}
                  
                  <div className="flex gap-2 mt-auto flex-wrap">
                    {profile.tags.map(tag => (
                      <Badge key={tag} variant="outline" className={isActive ? 'border-primary/30 text-primary bg-primary/10' : 'border-border'}>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>

      <Dialog open={!!draftProfile} onOpenChange={(open) => !open && setDraftProfile(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Inferred Style Traits</DialogTitle>
            <DialogDescription>
              A local estimate from {draftProfile?.sourceCount ?? 0} reference video{draftProfile?.sourceCount === 1 ? '' : 's'}. Review and edit it before saving.
            </DialogDescription>
          </DialogHeader>
          
          {draftProfile && (
            <div className="space-y-6 py-4">
              <div className="space-y-2">
                <Label htmlFor="profile-name">Profile Name</Label>
                <Input 
                  id="profile-name" 
                  value={draftProfile.name}
                  onChange={(e) => setDraftProfile({...draftProfile, name: e.target.value})}
                  placeholder="e.g. My Vlog Style"
                />
              </div>
              
              <div className="space-y-3">
                <Label>Locally Estimated Traits</Label>
                <div className="grid grid-cols-2 gap-3 bg-muted/30 p-4 rounded-lg border border-border">
                  <div className="space-y-1">
                    <Label htmlFor="cutting-pace" className="text-xs text-muted-foreground uppercase tracking-wider">Cutting Pace</Label>
                    <select id="cutting-pace" className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={draftProfile.traits.cuttingPace} onChange={(event) => setDraftProfile({...draftProfile, traits: {...draftProfile.traits, cuttingPace: event.target.value}})}>
                      <option>Slow</option><option>Moderate</option><option>Fast</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="broll-density" className="text-xs text-muted-foreground uppercase tracking-wider">B-Roll Density</Label>
                    <select id="broll-density" className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={draftProfile.traits.bRollDensity} onChange={(event) => setDraftProfile({...draftProfile, traits: {...draftProfile.traits, bRollDensity: event.target.value}})}>
                      <option>Low</option><option>Moderate</option><option>High</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <input id="captions-enabled" type="checkbox" className="h-4 w-4 accent-primary" checked={draftProfile.traits.captions} onChange={(event) => setDraftProfile({...draftProfile, traits: {...draftProfile.traits, captions: event.target.checked}})} />
                    <Label htmlFor="captions-enabled" className="text-sm">Captions</Label>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <input id="zoom-enabled" type="checkbox" className="h-4 w-4 accent-primary" checked={draftProfile.traits.zoom} onChange={(event) => setDraftProfile({...draftProfile, traits: {...draftProfile.traits, zoom: event.target.checked}})} />
                    <Label htmlFor="zoom-enabled" className="text-sm">Auto-Zoom</Label>
                  </div>
                </div>
                <div className="flex gap-2 items-start text-xs text-muted-foreground bg-primary/5 p-3 rounded-lg border border-primary/10">
                  <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <p>These traits were estimated locally without uploading your video. They act as directives for the timeline builder.</p>
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraftProfile(null)}>Cancel</Button>
            <Button onClick={handleSaveProfile}>Save Style Profile</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
