import { useMemo, useState } from 'react';
import { palette } from '@eduphysics/ui';
import type { CaseSummary, Manifest } from '../data/types';
import { useCase } from '../hooks/useCase';
import { outlineLab } from '../physics/geometry';
import { variantText } from '../content/boundaries';
import { Tex } from '../components/Tex';
import { SourceTag, FlowBadge } from '../components/Badge';
import { FlowCanvas, VIEWPORTS } from '../components/FlowCanvas';
import { Chart } from '../components/Chart';

function DomainDiagram() {
  // Not to scale: the airfoil is drawn large so the labels fit
  return (
    <svg viewBox="0 0 640 300" className="w-full" role="img" aria-label="Computational domain and boundary conditions">
      <rect x="40" y="30" width="560" height="230" fill="rgba(18,31,61,0.5)" stroke="#94a3b8" strokeWidth="1.2" />
      <path d="M 170 147 C 175 136, 205 131, 240 133 C 268 135, 292 141, 306 148 C 282 151, 225 153, 196 153 C 180 153, 171 151, 170 147 Z" fill="#121f3d" stroke="#fbbf24" strokeWidth="1.6" transform="rotate(-6 238 145)" />
      {[60, 95, 130, 165, 200, 235].map((y) => <path key={y} d={`M 44 ${y} l 26 0 m -6 -4 l 6 4 l -6 4`} stroke="#38e1ff" strokeWidth="1.3" fill="none" />)}
      <path d="M 560 150 q 15 -10 30 0" stroke="#2dd4bf" fill="none" strokeWidth="1.3" />
      <text x="48" y="22" fontSize="12" fill={palette.signal.cyan}>Inlet: u = U∞, v = 0</text>
      <text x="600" y="22" fontSize="12" textAnchor="end" fill={palette.signal.teal}>Outlet: convective, traction-free</text>
      <text x="320" y="48" fontSize="12" textAnchor="middle" fill={palette.text.body}>Open side: p = p∞, ∂u/∂y = ∂v/∂y = 0</text>
      <text x="320" y="252" fontSize="12" textAnchor="middle" fill={palette.text.body}>Open side: p = p∞, ∂u/∂y = ∂v/∂y = 0</text>
      <text x="238" y="182" fontSize="12" textAnchor="middle" fill={palette.signal.amber}>Wall: u = v = 0 (no slip, no penetration)</text>
      <text x="105" y="285" fontSize="11" textAnchor="middle" fill={palette.text.muted}>10c</text>
      <text x="410" y="285" fontSize="11" textAnchor="middle" fill={palette.text.muted}>20c</text>
      <line x1="40" x2="170" y1="272" y2="272" stroke="#64748b" /><line x1="170" x2="600" y1="272" y2="272" stroke="#64748b" strokeDasharray="4 3" />
      <text x="592" y="134" fontSize="11" textAnchor="end" fill={palette.text.muted}>±10c to each side</text>
      <text x="320" y="296" fontSize="10" textAnchor="middle" fill={palette.text.faint}>not to scale</text>
    </svg>
  );
}

const conditions = [
  { name: 'Airfoil surface: no-slip and no-penetration (always enforced)', tex: '\\mathbf u = \\mathbf 0 \\text{ on the wall}', body: 'A viscous fluid does not slide over or pass through a solid surface. No-penetration (zero normal velocity) applies even to inviscid flow; no-slip (zero tangential velocity) is what creates the boundary layer, skin friction and, ultimately, the circulation. The solver imposes both at the exact cut-cell wall position. They are not adjustable here: removing no-slip would turn the problem into the inviscid Euler equations, which this solver does not solve.' },
  { name: 'Inlet (left)', tex: 'u = U_\\infty,\\; v = 0', body: 'The undisturbed free stream. It must be far enough upstream that the airfoil\'s influence (upwash ahead of a lifting airfoil, displacement by the viscous layers) has decayed; that influence falls off only slowly with distance, like 1/r.' },
  { name: 'Outlet (right)', tex: '\\frac{\\partial u}{\\partial t} + U_\\infty\\frac{\\partial u}{\\partial x} = 0,\\quad p = 2\\nu\\frac{\\partial u}{\\partial x},\\quad \\frac{\\partial v}{\\partial x} = 0', body: 'A convective condition carries the wake (and shed vortices) out of the domain at the free-stream speed with little reflection, and the traction-free pressure condition leaves the outflow unforced. Simpler choices (zero gradient with fixed pressure) are acceptable only far downstream where the wake has relaxed.' },
  { name: 'Top and bottom', tex: 'p = p_\\infty,\\; \\frac{\\partial u}{\\partial y} = \\frac{\\partial v}{\\partial y} = 0', body: '"Open" far-field boundaries: the reference pressure is imposed and fluid may cross them. Placed 10 chords away so that the pressure field of the airfoil has decayed. Slip walls instead (v = 0) would model a wind tunnel, with blockage.' },
];

export function BoundaryPage({ manifest }: { manifest: Manifest }) {
  const b = manifest.bc_explorer;
  const variants = useMemo(() => manifest.cases.filter((c) => c.airfoil === b.airfoil && c.reynolds === b.reynolds && c.aoa_deg === b.aoa), [manifest, b]);
  const base = variants.find((c) => c.variant === 'baseline');
  const others = variants.filter((c) => c.variant !== 'baseline');
  const [chosen, setChosen] = useState<string | null>(null);
  const current = others.find((c) => c.variant === chosen) ?? others[0];
  const loaded = useCase(current?.id ?? null).loaded;
  const baseLoaded = useCase(base?.id ?? null).loaded;
  const airfoil = manifest.airfoils.find((a) => a.id === b.airfoil)!;
  const outline = useMemo(() => outlineLab(airfoil.outline, b.aoa), [airfoil, b.aoa]);
  const delta = (c: CaseSummary, k: 'cl' | 'cd') => (base ? (100 * (c[k] - base[k])) / base[k] : NaN);

  const cpSeries = (rec: typeof loaded, id: string, color: string, dash?: string) => {
    if (!rec) return [];
    const s = rec.record.surface, k = s.cp.length - 1;
    const pts = (upper: number) => s.station.map((x, i) => [x, s.cp[k][i], s.upper[i]] as const).filter((p) => p[2] === upper).map((p) => [p[0], p[1]] as [number, number]).sort((a, c) => a[0] - c[0]);
    return [{ id: `${id}u`, label: `${id} (upper)`, points: pts(1), color, kind: 'line' as const, dash }, { id: `${id}l`, label: '', points: pts(0), color, kind: 'line' as const, dash: dash ?? '5 3' }];
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <section className="panel p-5">
        <h1 className="font-display text-xl font-semibold text-slate-100">Boundary conditions</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">A simulation can only cover a finite region, so every boundary needs a condition that stands in for the rest of the world. Good conditions are placed where the flow is close to what they impose, and let disturbances (the wake, shed vortices) leave without reflecting back.</p>
        <div className="mt-4 space-y-4">
          <div className="mx-auto max-w-3xl"><DomainDiagram /></div>
          <div className="grid gap-3 md:grid-cols-2">
            {conditions.map((c) => (
              <div key={c.name} className="rounded-lg border border-white/10 bg-space-950/50 p-3">
                <h2 className="text-sm font-semibold text-slate-200">{c.name}</h2>
                <Tex display>{c.tex}</Tex>
                <p className="text-[13px] leading-relaxed text-slate-300">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel p-5" aria-labelledby="explorer-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="explorer-h" className="font-display text-lg font-semibold text-slate-100">Explorer: what if the boundaries were poorly placed?</h2>
          <SourceTag kind="cfd" />
        </div>
        <p className="mt-1 text-sm text-slate-300">Every variant below is a separate simulation of NACA {b.airfoil} at Re = {b.reynolds}, α = {b.aoa}°, differing only in the domain or the boundary conditions.</p>
        {!base || others.length === 0 ? (
          <p className="mt-4 rounded-lg border border-white/10 p-3 text-sm text-slate-400">The boundary-condition variants have not been computed in this dataset yet. Generate them with <code className="font-mono text-slate-300">python -m eduphysics_fluids generate --preset bc</code>.</p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="py-2">Configuration</th><th>C<sub>L</sub></th><th>ΔC<sub>L</sub></th><th>C<sub>D</sub></th><th>ΔC<sub>D</sub></th><th>Flow</th></tr></thead>
                <tbody>
                  {[base, ...others].map((c) => (
                    <tr key={c.id} onClick={() => c.variant !== 'baseline' && setChosen(c.variant)}
                      className={`border-t border-white/5 ${c.variant === current?.variant ? 'bg-signal-cyan/10' : c.variant !== 'baseline' ? 'cursor-pointer hover:bg-white/5' : ''}`}>
                      <td className="py-2 text-slate-200">{variantText[c.variant]?.title ?? c.variant}</td>
                      <td className="font-mono">{c.cl.toFixed(4)}</td>
                      <td className="font-mono">{c.variant === 'baseline' ? '—' : `${delta(c, 'cl') >= 0 ? '+' : ''}${delta(c, 'cl').toFixed(1)}%`}</td>
                      <td className="font-mono">{c.cd.toFixed(4)}</td>
                      <td className="font-mono">{c.variant === 'baseline' ? '—' : `${delta(c, 'cd') >= 0 ? '+' : ''}${delta(c, 'cd').toFixed(1)}%`}</td>
                      <td><FlowBadge kind={c.class} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {current && (
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">{variantText[current.variant]?.title}</h3>
                  <p className="mt-1 text-[13px] text-slate-300">{variantText[current.variant]?.what}</p>
                  <p className="mt-1 text-[13px] text-slate-400"><b className="text-slate-300">Why it matters:</b> {variantText[current.variant]?.expect}</p>
                  <div className="mt-3">
                    {loaded && <FlowCanvas loaded={loaded} stateIndex={loaded.fields.length - 1} view="pressure" viewport={VIEWPORTS.wake} outline={outline}
                      showStreamlines showContours={false} wallPoints={loaded.record.wall_points} fieldPoints={null} seeds={[]} onAddSeed={() => undefined} />}
                  </div>
                </div>
                <Chart title={<><span>Surface C<sub>p</sub>: variant vs baseline</span><SourceTag kind="cfd" /></>}
                  xLabel="x / c" yLabel="Cp" invertY ariaLabel="Pressure distribution comparison" xDomain={[-0.02, 1.02]}
                  series={[...cpSeries(baseLoaded, 'baseline', palette.text.muted), ...cpSeries(loaded, 'variant', palette.signal.cyan, undefined)]}
                  footer="Solid: upper surface, dashed: lower surface." />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
