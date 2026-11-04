import type { ReactNode } from 'react';
import { Logo } from './Logo';

/**
 * Top bar shared by EduPhysics apps: the platform mark (linking back to the catalogue) and the
 * current app's name, with optional navigation on the right.
 */
export function PlatformBar({ title, homeHref = '../', children }: { title?: string; homeHref?: string; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-space-950/70 px-4 py-2.5 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <a href={homeHref} className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-cyan/70" aria-label="EduPhysics home">
          <Logo />
          <span className="font-display text-sm font-semibold tracking-[0.2em] text-slate-200">EDUPHYSICS</span>
        </a>
        {title && (
          <>
            <span className="text-slate-600" aria-hidden="true">/</span>
            <span className="truncate font-display text-sm text-slate-300">{title}</span>
          </>
        )}
      </div>
      {children && <nav className="flex flex-wrap items-center gap-1.5">{children}</nav>}
    </header>
  );
}
