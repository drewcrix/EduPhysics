import { Component, useEffect, useState, type ReactNode } from 'react';
import { PlatformBar } from '@eduphysics/ui';
import { loadManifest } from './data/loader';
import type { Manifest } from './data/types';
import { hrefFor, useRoute, type Page } from './hooks/useRoute';
import { SimulatorPage } from './pages/SimulatorPage';
import { TheoryPage } from './pages/TheoryPage';
import { HighLiftPage } from './pages/HighLiftPage';
import { BoundaryPage } from './pages/BoundaryPage';

const TABS: [Page, string][] = [['simulator', 'Simulator'], ['boundaries', 'Boundary conditions'], ['high-lift', 'High-lift devices'], ['theory', 'Theory']];

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="m-6 rounded-xl border border-signal-rose/40 bg-signal-rose/10 p-4 text-sm text-slate-200" role="alert">
          <p className="font-semibold text-signal-rose">Something went wrong while drawing this page.</p>
          <p className="mt-1 font-mono text-xs text-slate-400">{this.state.error.message}</p>
          <button type="button" className="btn-ghost mt-3" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [route, go] = useRoute();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadManifest().then(setManifest).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    if (route.page === 'theory' && route.section) document.getElementById(route.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0 });
  }, [route.page, route.section, manifest]);

  useEffect(() => {
    const names: Record<Page, string> = { simulator: 'Simulator', boundaries: 'Boundary conditions', 'high-lift': 'High-lift devices', theory: 'Theory' };
    document.title = `${names[route.page]} · Airfoil Flow Lab · EduPhysics`;
  }, [route.page]);

  return (
    <div className="min-h-screen">
      <PlatformBar title="Airfoil Flow Lab">
        {TABS.map(([page, label]) => (
          <a key={page} href={hrefFor(page)} aria-current={route.page === page ? 'page' : undefined}
            className={`rounded-md px-2.5 py-1 text-sm transition ${route.page === page ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}>{label}</a>
        ))}
      </PlatformBar>
      <ErrorBoundary>
        {error && (
          <div className="m-6 rounded-xl border border-signal-rose/40 bg-signal-rose/10 p-4 text-sm text-slate-200" role="alert">
            Could not load the flow dataset: {error}. If you are developing locally, generate it with the Python backend (see README).
          </div>
        )}
        {!manifest && !error && <p className="p-6 text-sm text-slate-400" role="status">Loading dataset…</p>}
        {manifest && route.page === 'simulator' && <SimulatorPage manifest={manifest} params={route.params} go={go} />}
        {manifest && route.page === 'theory' && <TheoryPage manifest={manifest} />}
        {manifest && route.page === 'high-lift' && <HighLiftPage manifest={manifest} />}
        {manifest && route.page === 'boundaries' && <BoundaryPage manifest={manifest} />}
      </ErrorBoundary>
      <footer className="border-t border-white/10 px-6 py-4 text-[11px] text-slate-500">
        Airfoil Flow Lab · precomputed 2D incompressible Navier–Stokes simulations ({manifest ? `${manifest.cases.length} cases` : '…'}). Each result is labelled as CFD, analytical theory, empirical data or a conceptual illustration.
      </footer>
    </div>
  );
}
