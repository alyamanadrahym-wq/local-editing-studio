import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { Shell } from '@/components/layout/Shell';
import Studio from '@/pages/Studio';
import Settings from '@/pages/Settings';
import StyleProfiles from '@/pages/StyleProfiles';
import Assets from '@/pages/Assets';
import Script from '@/pages/Script';
import Export from '@/pages/Export';
import { useStore, updateProject } from '@/lib/store';
import { restoreLocalAssets } from '@/lib/local-media';

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Studio} />
          <Route path="/assets" component={Assets} />
          <Route path="/script" component={Script} />
          <Route path="/export" component={Export} />
          <Route path="/styles" component={StyleProfiles} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  const storedAssets = useStore((state) => state.project.assets);
  const [mediaReady, setMediaReady] = useState(false);

  useEffect(() => {
    let active = true;
    const restoredUrls: string[] = [];
    void restoreLocalAssets(storedAssets).then(({ assets, missingIds }) => {
      restoredUrls.push(...assets.map((asset) => asset.url));
      if (!active) {
        restoredUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      updateProject((project) => ({
        assets,
        takes: project.takes.filter((take) => !missingIds.includes(take.assetId)),
        timeline: project.timeline.filter((item) => {
          const take = project.takes.find((candidate) => candidate.id === item.takeId);
          return take ? !missingIds.includes(take.assetId) : false;
        }),
      }));
      setMediaReady(true);
    }).catch(() => {
      if (active) setMediaReady(true);
    });
    return () => {
      active = false;
      restoredUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  if (!mediaReady) {
    return (
      <div className="h-screen w-screen bg-background text-foreground flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Restoring local media…
        </div>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
