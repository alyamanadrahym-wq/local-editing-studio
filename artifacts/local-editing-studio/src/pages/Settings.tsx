import React, { useEffect, useState } from 'react';
import { useStore, updateEngine, updateSettings, clearStore } from '@/lib/store';
import { clearLocalMedia, LOCAL_ENGINE_ORIGIN, localEngine } from '@/lib/local-media';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Settings2, ShieldCheck, Cloud, Cpu, Database, Trash2, LockKeyhole, Router, RefreshCw, CircleCheck, CircleX } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function Settings() {
  const settings = useStore((state) => state.settings);
  const engine = useStore((state) => state.engine);
  const [availability, setAvailability] = useState<{ gemini: boolean; openrouter: boolean } | null>(null);

  const checkEngine = async () => {
    localEngine.setPairingToken(settings.pairingToken);
    updateEngine(() => ({ status: 'checking', error: undefined }));
    try {
      const health = await localEngine.health();
      await localEngine.testPairing();
      updateEngine(() => ({ ...health, status: 'connected', error: undefined, lastCheckedAt: Date.now() }));
    } catch (error) {
      updateEngine(() => ({ status: 'disconnected', error: error instanceof Error ? error.message : 'Local engine is unavailable.', lastCheckedAt: Date.now() }));
    }
  };

  useEffect(() => {
    void checkEngine();
    fetch('/api/ai/providers')
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then(setAvailability)
      .catch(() => setAvailability({ gemini: false, openrouter: false }));
  }, []);

  const clearData = async () => {
    const confirmed = window.confirm('Clear the project, versions, settings, and all imported local media? This cannot be undone.');
    if (!confirmed) return;
    await clearLocalMedia().catch(() => undefined);
    clearStore();
    window.location.assign(import.meta.env.BASE_URL);
  };

  return (
    <div className="h-full w-full flex flex-col bg-background">
      <header className="h-14 border-b border-border flex items-center px-6 justify-between bg-card shrink-0">
        <div className="flex items-center gap-3"><Settings2 className="w-5 h-5 text-primary" /><h1 className="font-semibold text-lg text-foreground tracking-tight">Workspace Settings</h1></div>
      </header>

      <ScrollArea className="flex-1">
        <div className="max-w-3xl mx-auto w-full p-8 space-y-10">
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold mb-1">Local render engine</h2>
                <p className="text-sm text-muted-foreground">The browser talks only to <span className="font-mono">{LOCAL_ENGINE_ORIGIN}</span> for media processing.</p>
              </div>
              <Button data-testid="button-check-engine" variant="outline" onClick={() => void checkEngine()} disabled={engine.status === 'checking'}><RefreshCw className={`w-4 h-4 mr-2 ${engine.status === 'checking' ? 'animate-spin' : ''}`} />Check</Button>
            </div>
            <div data-testid="status-engine-health" className={`bg-card border rounded-xl p-5 ${engine.status === 'connected' ? 'border-emerald-400/30' : engine.status === 'disconnected' ? 'border-destructive/30' : 'border-border'}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold capitalize">{engine.status}</span>
                {engine.version && <span className="text-xs font-mono text-muted-foreground">v{engine.version}</span>}
              </div>
              {engine.status === 'connected' ? (
                <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                  <div className="rounded-lg bg-background border border-border p-3"><span className="text-muted-foreground">GPU / encoder</span><p className="font-medium mt-1">{engine.gpu?.available ? engine.gpu.name ?? 'CUDA available' : 'CPU fallback'}</p><p className="text-muted-foreground mt-1">{engine.gpu?.nvencAvailable ? `NVENC available${engine.gpu.selectedEncoder ? ` · selected: ${engine.gpu.selectedEncoder}` : ''}` : 'NVENC unavailable'}</p></div>
                  <div className="rounded-lg bg-background border border-border p-3"><span className="text-muted-foreground">Whisper</span><p className="font-medium mt-1">{engine.whisper?.available ? engine.whisper.model ?? 'Ready' : 'Unavailable'}</p></div>
                </div>
              ) : (
                <div className="mt-3 text-xs text-muted-foreground leading-relaxed">
                  <p>{engine.error ?? 'Checking the engine…'}</p>
                  {engine.status === 'disconnected' && <p className="mt-2">Install and start the Local Editing Engine, allow localhost access in your browser, then click Check. Analysis and MP4 export will remain disabled rather than simulate success.</p>}
                </div>
              )}
            </div>
            <div className="bg-card border border-border rounded-xl p-5 space-y-3">
              <div>
                <h3 className="font-semibold text-sm">Pair this browser</h3>
                <p className="text-xs text-muted-foreground mt-1">Run <span className="font-mono">run.ps1</span> on the laptop, then copy the pairing token it prints into this field. The token is stored only in this browser and is never displayed after entry.</p>
              </div>
              <input
                data-testid="input-pairing-token"
                type="password"
                autoComplete="off"
                value={settings.pairingToken}
                onChange={(event) => updateSettings(() => ({ pairingToken: event.target.value }))}
                placeholder="Paste pairing token"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p data-testid="status-pairing" className="text-xs text-muted-foreground">{settings.pairingToken ? 'Pairing token saved locally. Click Check to test engine connectivity.' : 'No pairing token saved. Media uploads and jobs are blocked.'}</p>
            </div>
          </section>

          <section className="space-y-6">
            <div>
              <h2 className="text-xl font-bold mb-1">Execution Mode</h2>
              <p className="text-sm text-muted-foreground">Choose whether the future reasoning layer may send text metadata to a provider. Media stays local in both modes.</p>
            </div>

            <RadioGroup value={settings.privacyMode} onValueChange={(value: 'local' | 'hybrid') => updateSettings(() => ({ privacyMode: value }))} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Label htmlFor="mode-local" className={`flex flex-col gap-4 border-2 rounded-xl p-6 cursor-pointer transition-all ${settings.privacyMode === 'local' ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-muted-foreground/50'}`}>
                <div className="flex justify-between items-center w-full">
                  <div className="flex items-center gap-2 font-semibold"><ShieldCheck className={`w-5 h-5 ${settings.privacyMode === 'local' ? 'text-primary' : 'text-muted-foreground'}`} />Strict Local</div>
                  <RadioGroupItem value="local" id="mode-local" className="sr-only" />
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${settings.privacyMode === 'local' ? 'border-primary' : 'border-muted-foreground'}`}>{settings.privacyMode === 'local' && <div className="w-2 h-2 rounded-full bg-primary" />}</div>
                </div>
                <p className="text-sm text-muted-foreground font-normal">Import, script planning, take selection, versions, and exports stay inside this browser. No provider requests are made.</p>
              </Label>

              <Label htmlFor="mode-hybrid" className={`flex flex-col gap-4 border-2 rounded-xl p-6 cursor-pointer transition-all ${settings.privacyMode === 'hybrid' ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-muted-foreground/50'}`}>
                <div className="flex justify-between items-center w-full">
                  <div className="flex items-center gap-2 font-semibold"><Cloud className={`w-5 h-5 ${settings.privacyMode === 'hybrid' ? 'text-primary' : 'text-muted-foreground'}`} />Hybrid, opt-in</div>
                  <RadioGroupItem value="hybrid" id="mode-hybrid" className="sr-only" />
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${settings.privacyMode === 'hybrid' ? 'border-primary' : 'border-muted-foreground'}`}>{settings.privacyMode === 'hybrid' && <div className="w-2 h-2 rounded-full bg-primary" />}</div>
                </div>
                <p className="text-sm text-muted-foreground font-normal">Enable a future provider adapter for script text and approved metadata. Raw footage is never sent automatically.</p>
              </Label>
            </RadioGroup>
          </section>

          <section className={`space-y-6 transition-opacity duration-300 ${settings.privacyMode === 'local' ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center gap-2"><Router className="w-5 h-5 text-muted-foreground" /><h2 className="text-xl font-bold">Optional model provider</h2></div>
            <div className="bg-card border border-border rounded-xl p-6 space-y-6">
              <div className="grid gap-2">
                <Label htmlFor="provider">Provider</Label>
                <select id="provider" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={settings.modelProvider} onChange={(event) => updateSettings(() => ({ modelProvider: event.target.value as 'none' | 'gemini' | 'openrouter' }))} disabled={settings.privacyMode === 'local'}>
                  <option value="none">No provider connected</option>
                  <option value="gemini">Google Gemini API</option>
                  <option value="openrouter">OpenRouter</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                {(['gemini', 'openrouter'] as const).map((provider) => {
                  const ready = availability?.[provider] ?? false;
                  return (
                    <div key={provider} className="rounded-lg border border-border bg-background p-3 flex items-center gap-2">
                      {ready ? <CircleCheck className="w-4 h-4 text-emerald-400" /> : <CircleX className="w-4 h-4 text-muted-foreground" />}
                      <span className="capitalize">{provider}</span>
                      <span className="ml-auto text-muted-foreground">{availability === null ? 'Checking…' : ready ? 'Ready' : 'Not configured'}</span>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-lg border border-border bg-background p-3 flex items-start gap-2">
                <LockKeyhole className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">Credentials stay on the server (and in the desktop build must come from the OS keychain). They are never entered here or stored in localStorage. Each provider is configured independently.</p>
              </div>

              <div className="rounded-lg border border-border bg-background p-3 flex items-start gap-2">
                <Cpu className="w-4 h-4 text-primary mt-0.5" />
                <p className="text-xs text-muted-foreground leading-relaxed">Maximum 20 approved requests per provider per day. Limits remain separate, are never bypassed, and provider failure falls back to the fully local workflow.</p>
              </div>
            </div>
          </section>

          <section className="space-y-6 pt-6 border-t border-border">
            <div className="flex items-center gap-2 text-destructive"><Database className="w-5 h-5" /><h2 className="text-xl font-bold">Data Management</h2></div>
            <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 flex items-center justify-between gap-6">
              <div>
                <h3 className="font-semibold text-foreground mb-1">Clear Workspace Data</h3>
                <p className="text-sm text-muted-foreground">Permanently delete the project, imported media, scripts, timelines, versions, and settings from this browser.</p>
              </div>
              <Button variant="destructive" className="shrink-0" onClick={() => void clearData()}><Trash2 className="w-4 h-4 mr-2" />Clear All Data</Button>
            </div>
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}