import React from 'react';
import { Link, useLocation } from 'wouter';
import {
  Film,
  FolderOpen,
  Scissors,
  Settings2,
  MonitorPlay,
  Type,
  LayoutTemplate
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: '/', icon: Scissors, label: 'Studio' },
    { href: '/assets', icon: FolderOpen, label: 'Assets' },
    { href: '/script', icon: Type, label: 'Script' },
    { href: '/export', icon: MonitorPlay, label: 'Export' },
  ];

  const bottomItems = [
    { href: '/styles', icon: LayoutTemplate, label: 'Style Profiles' },
    { href: '/settings', icon: Settings2, label: 'Settings' },
  ];

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground selection:bg-primary/30 selection:text-primary">
      {/* Slim Sidebar */}
      <nav className="w-16 border-r border-border bg-card flex flex-col items-center py-4 z-20">
        <div className="mb-8 flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <Film className="h-6 w-6" />
        </div>

        <div className="flex flex-col gap-4 flex-1">
          {navItems.map((item) => (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link href={item.href} className="group relative flex h-10 w-10 items-center justify-center rounded-lg">
                  {location === item.href && (
                    <div className="absolute inset-0 rounded-lg bg-primary/10 text-primary" />
                  )}
                  {location === item.href && (
                    <div className="absolute -left-3 h-8 w-1 rounded-r-full bg-primary" />
                  )}
                  <item.icon
                    className={cn(
                      'h-5 w-5 transition-colors',
                      location === item.href
                        ? 'text-primary'
                        : 'text-muted-foreground group-hover:text-foreground'
                    )}
                  />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={16}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="flex flex-col gap-4 mt-auto">
          {bottomItems.map((item) => (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link href={item.href} className="group relative flex h-10 w-10 items-center justify-center rounded-lg">
                  {location === item.href && (
                    <div className="absolute inset-0 rounded-lg bg-primary/10 text-primary" />
                  )}
                  {location === item.href && (
                    <div className="absolute -left-3 h-8 w-1 rounded-r-full bg-primary" />
                  )}
                  <item.icon
                    className={cn(
                      'h-5 w-5 transition-colors',
                      location === item.href
                        ? 'text-primary'
                        : 'text-muted-foreground group-hover:text-foreground'
                    )}
                  />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={16}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden relative flex flex-col">
        {children}
      </main>
    </div>
  );
}
