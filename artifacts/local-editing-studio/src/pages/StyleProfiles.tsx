import React from 'react';
import { useStore, updateSettings } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { LayoutTemplate, CheckCircle2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

const profiles = [
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

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center px-6 justify-between bg-card shrink-0">
        <div className="flex items-center gap-3">
          <LayoutTemplate className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg text-foreground tracking-tight">Style Profiles</h1>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="max-w-5xl mx-auto w-full p-8">
          <div className="mb-8 max-w-2xl">
            <h2 className="text-2xl font-bold mb-2">Edit Directives</h2>
            <p className="text-muted-foreground">
              Style profiles instruct the local AI on how to assemble your timeline. 
              The system will prioritize takes and set pacing based on the active profile.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {profiles.map(profile => {
              const isActive = settings.styleProfile === profile.id;
              return (
                <div 
                  key={profile.id}
                  onClick={() => updateSettings(s => ({ styleProfile: profile.id }))}
                  className={`relative p-6 rounded-xl border-2 cursor-pointer transition-all ${
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
                  <h3 className="text-lg font-semibold mb-2 text-foreground">{profile.name}</h3>
                  <p className="text-sm text-muted-foreground mb-6 line-clamp-2 h-10">
                    {profile.description}
                  </p>
                  <div className="flex gap-2 mt-auto">
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
    </div>
  );
}
