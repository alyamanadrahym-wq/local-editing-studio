import { useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { useStore, updateSettings, type CustomStyleProfile } from '@/lib/store';
import {
  aggregateStyleAnalyses,
  analyzeStyleFile,
  type AggregateStyleAnalysis,
  type FileStyleAnalysis,
} from '@/lib/style-analyzer';
import { Button } from '@/components/ui/button';
import { LayoutTemplate, CheckCircle2, Upload, Video, Info, Settings2, Trash2, ShieldCheck, AlertCircle } from 'lucide-react';
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

export default function StyleProfiles() {
  const settings = useStore((s) => s.settings);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [draftProfile, setDraftProfile] = useState<{
    name: string;
    analysis: AggregateStyleAnalysis;
  } | null>(null);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    setIsAnalyzing(true);
    setAnalysisError('');
    const analyses: FileStyleAnalysis[] = [];
    const failures: string[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        setAnalysisStatus(`Sampling video ${index + 1} of ${files.length}: ${files[index].name}`);
        try {
          analyses.push(await analyzeStyleFile(files[index]));
        } catch (error) {
          failures.push(`${files[index].name}: ${error instanceof Error ? error.message : 'Could not analyze file.'}`);
        }
      }
      if (!analyses.length) throw new Error(failures.join(' '));
      setDraftProfile({
        name: files.length === 1 ? files[0].name.replace(/\.[^/.]+$/, '') + ' Style' : `My ${files.length}-video Style`,
        analysis: aggregateStyleAnalyses(analyses),
      });
      if (failures.length) setAnalysisError(failures.join(' '));
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'The selected videos could not be analyzed.');
    } finally {
      setAnalysisStatus('');
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = () => {
    if (!draftProfile) return;
    
    const newProfile: CustomStyleProfile = {
      id: crypto.randomUUID(),
      name: draftProfile.name || 'Untitled Style',
      description: `Custom style inferred in this browser from sampled frames and audio across ${draftProfile.analysis.files.length} reference video${draftProfile.analysis.files.length === 1 ? '' : 's'}.`,
      tags: ['Custom', draftProfile.analysis.traits.cuttingPace + ' Pace', draftProfile.analysis.traits.bRollDensity + ' B-Roll'],
      traits: draftProfile.analysis.traits,
      inference: {
        sourceCount: draftProfile.analysis.files.length,
        analyzedAt: Date.now(),
        privacy: 'browser-local',
        evidence: draftProfile.analysis.evidence,
      },
    };

    updateSettings((s) => ({
      customProfiles: [...s.customProfiles, newProfile],
      styleProfile: newProfile.id
    }));
    
    setDraftProfile(null);
  };

  const setReviewedTrait = (
    key: keyof CustomStyleProfile['traits'],
    value: CustomStyleProfile['traits'][keyof CustomStyleProfile['traits']],
  ) => {
    setDraftProfile((current) => current ? {
      ...current,
      analysis: {
        ...current.analysis,
        traits: { ...current.analysis.traits, [key]: value },
        evidence: {
          ...current.analysis.evidence,
          [key]: {
            confidence: 100,
            source: 'Manual review',
            detail: 'Adjusted by you after reviewing the browser-local analysis.',
          },
        },
      },
    } : null);
  };

  const deleteProfile = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    updateSettings((s) => {
      const remaining = s.customProfiles.filter(p => p.id !== id);
      return {
        customProfiles: remaining,
        styleProfile: s.styleProfile === id ? 'cinematic' : s.styleProfile
      };
    });
  };

  const allProfiles: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    isCustom: boolean;
    traits: CustomStyleProfile['traits'] | null;
    inference?: CustomStyleProfile['inference'];
  }> = [
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
        data-testid="input-reference-videos"
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
                  <p className="text-xs text-muted-foreground mt-1">Sample real frames and audio to infer editing traits.</p>
                </div>
              </div>
              <div className="flex gap-2 items-start rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span><strong className="text-foreground">Private by design:</strong> processing stays in this browser. No video, frame, or audio data is uploaded or sent over the network.</span>
              </div>
              <Button 
                onClick={() => fileInputRef.current?.click()} 
                disabled={isAnalyzing}
                className="w-full gap-2 mt-1"
                variant="secondary"
                data-testid="button-select-reference-videos"
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
              {analysisStatus && (
                <p className="truncate text-xs text-muted-foreground" data-testid="status-local-analysis">{analysisStatus}</p>
              )}
              {analysisError && (
                <div className="flex items-start gap-2 text-xs text-destructive" data-testid="status-analysis-error">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{analysisError}</span>
                </div>
              )}
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
                    <div className="mb-4 space-y-2 rounded-lg border border-border/50 bg-background/50 p-3 text-xs">
                      {[
                        ['cuttingPace', 'Pace', profile.traits.cuttingPace],
                        ['bRollDensity', 'B-Roll', profile.traits.bRollDensity],
                        ['captions', 'Captions', profile.traits.captions ? 'Yes' : 'No'],
                        ['zoom', 'Zoom', profile.traits.zoom ? 'Yes' : 'No'],
                        ['audioActivity', 'Audio', profile.traits.audioActivity ?? 'Unknown'],
                      ].map(([key, label, value]) => {
                        const item = profile.inference?.evidence[key as string];
                        return (
                          <div key={key} className="flex items-start gap-2" data-testid={`evidence-${key}-${profile.id}`}>
                            <Settings2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"/>
                            <div className="min-w-0 flex-1">
                              <div className="flex justify-between gap-2">
                                <span><span className="text-muted-foreground">{label}:</span> <span className="font-medium">{value}</span></span>
                                {item && <span className="shrink-0 font-medium text-primary">{item.confidence}%</span>}
                              </div>
                              {item && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{item.source} · {item.detail}</p>}
                            </div>
                          </div>
                        );
                      })}
                      {profile.inference && (
                        <div className="flex items-center gap-1.5 border-t border-border/50 pt-2 text-[11px] text-emerald-600">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Browser-local evidence from {profile.inference.sourceCount} file{profile.inference.sourceCount === 1 ? '' : 's'}
                        </div>
                      )}
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Inferred Style Traits</DialogTitle>
            <DialogDescription>
              Aggregated from sampled frames and audio in {draftProfile?.analysis.files.length ?? 0} reference video{draftProfile?.analysis.files.length === 1 ? '' : 's'}. Review before saving.
            </DialogDescription>
          </DialogHeader>
          
          {draftProfile && (
            <div className="space-y-5 py-3">
              <div className="space-y-2">
                <Label htmlFor="profile-name">Profile Name</Label>
                <Input 
                  id="profile-name" 
                  value={draftProfile.name}
                  onChange={(e) => setDraftProfile({...draftProfile, name: e.target.value})}
                  placeholder="e.g. My Vlog Style"
                  data-testid="input-style-profile-name"
                />
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label>Locally Estimated Traits</Label>
                  <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-600">
                    <ShieldCheck className="h-3 w-3" /> Browser only
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 bg-muted/30 p-4 rounded-lg border border-border">
                  <div className="space-y-1">
                    <Label htmlFor="cutting-pace" className="text-xs text-muted-foreground uppercase tracking-wider">Cutting Pace</Label>
                    <select id="cutting-pace" data-testid="select-cutting-pace" className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={draftProfile.analysis.traits.cuttingPace} onChange={(event) => setReviewedTrait('cuttingPace', event.target.value)}>
                      <option>Slow</option><option>Moderate</option><option>Fast</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="broll-density" className="text-xs text-muted-foreground uppercase tracking-wider">B-Roll Density</Label>
                    <select id="broll-density" data-testid="select-broll-density" className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm" value={draftProfile.analysis.traits.bRollDensity} onChange={(event) => setReviewedTrait('bRollDensity', event.target.value)}>
                      <option>Low</option><option>Moderate</option><option>High</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <input id="captions-enabled" data-testid="checkbox-captions" type="checkbox" className="h-4 w-4 accent-primary" checked={draftProfile.analysis.traits.captions} onChange={(event) => setReviewedTrait('captions', event.target.checked)} />
                    <Label htmlFor="captions-enabled" className="text-sm">Captions</Label>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <input id="zoom-enabled" data-testid="checkbox-zoom" type="checkbox" className="h-4 w-4 accent-primary" checked={draftProfile.analysis.traits.zoom} onChange={(event) => setReviewedTrait('zoom', event.target.checked)} />
                    <Label htmlFor="zoom-enabled" className="text-sm">Auto-Zoom</Label>
                  </div>
                </div>

                <div className="space-y-2">
                  {[
                    ['cuttingPace', 'Cutting pace', draftProfile.analysis.traits.cuttingPace],
                    ['bRollDensity', 'B-roll density', draftProfile.analysis.traits.bRollDensity],
                    ['captions', 'Caption likelihood', draftProfile.analysis.traits.captions ? 'Detected' : 'Not detected'],
                    ['zoom', 'Zoom activity', draftProfile.analysis.traits.zoom ? 'Detected' : 'Not detected'],
                    ['audioActivity', 'Audio activity', draftProfile.analysis.traits.audioActivity ?? 'Unavailable'],
                  ].map(([key, label, value]) => {
                    const evidence = draftProfile.analysis.evidence[key as string];
                    return (
                      <div key={key} className="rounded-lg border border-border bg-card p-3" data-testid={`aggregate-evidence-${key}`}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium">{label}: {value}</span>
                          <Badge variant="secondary">{evidence.confidence}% confidence</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground"><strong>{evidence.source}</strong> · {evidence.detail}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  <Label>Per-file evidence</Label>
                  {draftProfile.analysis.files.map((file) => (
                    <div key={file.fileName} className="rounded-lg border border-border bg-muted/20 p-3 text-xs" data-testid={`file-analysis-${file.fileName}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate font-medium">{file.fileName}</span>
                        <span className="shrink-0 text-muted-foreground">{file.sampledFrames} frames · {Math.round(file.duration)}s</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                        <span>{file.detectedCuts} likely cuts</span>
                        <span>Motion {(file.motionScore * 100).toFixed(1)}%</span>
                        <span>Text-like frames {Math.round(file.textFrameRatio * 100)}%</span>
                        <span>Zoom score {(file.zoomScore * 100).toFixed(1)}%</span>
                        <span>Audio {file.audioActivity}{file.audioActiveRatio === undefined ? '' : ` (${Math.round(file.audioActiveRatio * 100)}% active)`}</span>
                      </div>
                      {file.warning && <p className="mt-2 text-amber-600">{file.warning}</p>}
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 items-start text-xs text-muted-foreground bg-primary/5 p-3 rounded-lg border border-primary/10">
                  <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <p>Frames are drawn to an in-memory canvas and audio is decoded into memory for sampling. Object URLs are revoked after analysis. No frame, waveform, filename, or media byte is uploaded or sent to a network service.</p>
                </div>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraftProfile(null)} data-testid="button-cancel-style-profile">Cancel</Button>
            <Button onClick={handleSaveProfile} data-testid="button-save-style-profile">Save Style Profile</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
