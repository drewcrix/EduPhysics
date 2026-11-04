import { useMemo, useState } from 'react';
import { palette } from '@eduphysics/ui';
import type { Manifest } from '../data/types';
import { deviceGeometry, extendedChord, type DeviceId, type Element } from '../physics/highlift';
import { plainFlap } from '../physics/theory';
import { devices, RAYMER_NOTE } from '../content/highlift';
import { Chart } from '../components/Chart';
import { SourceTag } from '../components/Badge';
import { Tex } from '../components/Tex';
import { Rich } from '../components/Rich';

const ROLE_COLOR: Record<Element['role'], string> = {
  main: palette.signal.amber, flap: palette.signal.cyan, vane: palette.signal.teal, slat: palette.signal.violet, krueger: palette.signal.violet, split: palette.signal.cyan,
};

function DeviceDrawing({ elements, ghost }: { elements: Element[]; ghost: [number, number][] }) {
  const x0 = -0.2, x1 = 1.35, y0 = -0.32, y1 = 0.18;
  const W = 640, H = (W * (y1 - y0)) / (x1 - x0);
  const sx = (x: number) => ((x - x0) / (x1 - x0)) * W;
  const sy = (y: number) => H - ((y - y0) / (y1 - y0)) * H;
  const path = (p: [number, number][]) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(' ') + 'Z';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Schematic of the high-lift device">
      <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} stroke="rgba(148,163,184,0.18)" strokeDasharray="3 5" />
      <path d={path(ghost)} fill="none" stroke="rgba(148,163,184,0.45)" strokeDasharray="4 4" />
      {elements.map((e, i) => <path key={i} d={path(e.points)} fill={palette.space[800]} stroke={ROLE_COLOR[e.role]} strokeWidth="1.6" strokeLinejoin="round" />)}
      <text x={8} y={16} fontSize="11" fill={palette.text.muted}>dashed: clean section (NACA 2412, true shape)</text>
      <text x={W - 8} y={16} fontSize="11" textAnchor="end" fill={palette.signal.rose}>conceptual illustration</text>
    </svg>
  );
}

/** Illustrative lift curves for the usual qualitative effects */
function sketchCurve(alpha0: number, slope: number, alphaStall: number, clMax: number): [number, number][] {
  const pts: [number, number][] = [];
  const alphaKnee = alphaStall - 4;
  const clKnee = slope * (alphaKnee - alpha0);
  for (let a = -6; a <= 26; a += 0.5) {
    let cl: number;
    if (a <= alphaKnee) cl = slope * (a - alpha0);
    else if (a <= alphaStall) { const t = (a - alphaKnee) / (alphaStall - alphaKnee); cl = clKnee + (clMax - clKnee) * (2 * t - t * t); }
    else cl = clMax - 0.09 * (a - alphaStall) ** 1.3;
    pts.push([a, cl]);
  }
  return pts;
}

export function HighLiftPage({ manifest }: { manifest: Manifest }) {
  const [id, setId] = useState<DeviceId>('fowler');
  const [deploy, setDeploy] = useState(1);
  const [flapRatio, setFlapRatio] = useState(0.25);
  const [deflection, setDeflection] = useState(10);
  const device = devices.find((d) => d.id === id)!;
  const section = manifest.airfoils.find((a) => a.id === '2412') ?? manifest.airfoils[0];
  const elements = useMemo(() => deviceGeometry(id, section.outline, deploy), [id, section, deploy]);
  const ghost = useMemo(() => section.outline.x.map((x, i) => [x, section.outline.y[i]] as [number, number]), [section]);
  const flap = plainFlap(flapRatio, deflection);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <div className="rounded-xl border border-signal-rose/30 bg-signal-rose/5 p-4 text-sm leading-relaxed text-slate-300">
        <div className="mb-1 flex flex-wrap gap-2"><SourceTag kind="concept" /><SourceTag kind="theory" /><SourceTag kind="empirical" /></div>
        The simulator's solver handles one solid body per grid line, so multi-element configurations with slots are outside what it computes. The drawings are schematic, the plain-flap numbers come from
        thin-airfoil theory, and the maximum-lift figures are published design values for high Reynolds numbers.
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="High-lift devices" className="space-y-3">
          {(['trailing', 'leading'] as const).map((edge) => (
            <div key={edge} className="panel p-3">
              <h2 className="label mb-2">{edge === 'trailing' ? 'Trailing-edge devices' : 'Leading-edge devices'}</h2>
              <div className="flex flex-col gap-1">
                {devices.filter((d) => d.edge === edge).map((d) => (
                  <button key={d.id} type="button" onClick={() => setId(d.id)} aria-pressed={d.id === id}
                    className={`rounded-md px-2 py-1.5 text-left text-sm transition ${d.id === id ? 'bg-signal-cyan/15 text-signal-cyan' : 'text-slate-300 hover:bg-white/5'}`}>{d.name}</button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-5">
          <section className="panel p-4" aria-labelledby="device-h">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 id="device-h" className="font-display text-xl font-semibold text-slate-100">{device.name}</h1>
              <SourceTag kind="concept" />
            </div>
            <p className="mt-1 text-sm text-slate-300">{device.summary}</p>
            <div className="mt-3"><DeviceDrawing elements={elements} ghost={ghost} /></div>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Retracted
                <input type="range" min={0} max={1} step={0.01} value={deploy} onChange={(e) => setDeploy(Number(e.target.value))} className="w-48 accent-signal-cyan" aria-label="Deployment" />
                Deployed
              </label>
              <span className="font-mono text-xs text-slate-400">overall chord c′/c ≈ {extendedChord(elements).toFixed(2)}</span>
            </div>
            <dl className="mt-4 grid gap-3 md:grid-cols-2">
              {([['Camber', device.camber], ['Effective chord', device.chord], ['Pressure distribution', device.pressure], ['Boundary layer and separation', device.separation], ['Maximum lift and stall angle', device.maxLift]] as const).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-white/10 bg-space-950/50 p-3">
                  <dt className="text-xs font-semibold text-slate-200">{k}</dt>
                  <dd className="mt-1 text-[13px] leading-relaxed text-slate-300"><Rich text={v} /></dd>
                </div>
              ))}
              <div className="rounded-lg border border-signal-lime/25 bg-signal-lime/5 p-3">
                <dt className="flex items-center gap-2 text-xs font-semibold text-slate-200">Typical ΔC<sub>l,max</sub> <SourceTag kind="empirical" /></dt>
                <dd className="mt-1 font-mono text-lg text-signal-lime">{device.typicalDeltaClmax}</dd>
                <dd className="text-[11px] leading-snug text-slate-500"><Rich text={RAYMER_NOTE} /></dd>
              </div>
            </dl>
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="panel p-4" aria-labelledby="flap-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="flap-h" className="font-display text-base font-semibold text-slate-100">Plain flap in thin-airfoil theory</h2>
                <SourceTag kind="theory" />
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-slate-300">A flap of chord <Tex>{'Ec'}</Tex> deflected by <Tex>{'\\delta'}</Tex> is a camber line with a kink at the hinge. With the hinge at <Tex>{'\\cos\\theta_h = 2E-1'}</Tex>, thin-airfoil theory gives</p>
              <Tex display>{'\\begin{gathered}\\Delta C_L = 2\\pi\\,\\tau\\,\\delta,\\qquad \\tau = 1 - \\frac{\\theta_h - \\sin\\theta_h}{\\pi}\\\\ \\Delta C_{m,c/4} = -\\frac{\\delta}{2}\\sin\\theta_h\\,(1-\\cos\\theta_h)\\end{gathered}'}</Tex>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-400">Flap chord E = {flapRatio.toFixed(2)}
                  <input type="range" min={0.1} max={0.4} step={0.01} value={flapRatio} onChange={(e) => setFlapRatio(Number(e.target.value))} className="mt-1 w-full accent-signal-violet" />
                </label>
                <label className="text-xs text-slate-400">Deflection δ = {deflection}°
                  <input type="range" min={0} max={30} step={1} value={deflection} onChange={(e) => setDeflection(Number(e.target.value))} className="mt-1 w-full accent-signal-violet" />
                </label>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
                {([['τ', flap.effectiveness.toFixed(3)], ['ΔC_L', flap.deltaCl.toFixed(3)], ['Δα_L0', `${flap.deltaAlphaL0Deg.toFixed(2)}°`], ['ΔC_m,c/4', flap.deltaCm.toFixed(3)]] as const).map(([k, v]) => (
                  <div key={k} className="rounded border border-white/10 bg-space-950/60 px-2 py-1"><dt className="text-[10px] text-slate-500">{k}</dt><dd className="text-slate-100">{v}</dd></div>
                ))}
              </dl>
              <p className="mt-2 text-[11px] leading-snug text-slate-500">Inviscid and linear: real flaps fall short of these values once the flow over the flap separates, typically beyond 10–15° of deflection, and the theory says nothing about maximum lift.</p>
            </section>

            <div>
              <Chart
                title={<><span>How devices change the lift curve</span><SourceTag kind="concept" /></>}
                xLabel="angle of attack α (deg)" yLabel="CL (schematic)" ariaLabel="Schematic lift curves with high-lift devices"
                xDomain={[-6, 26]} yDomain={[-0.4, 3.2]}
                series={[
                  { id: 'clean', label: 'clean', points: sketchCurve(-2, 0.105, 15, 1.55), color: palette.text.muted, kind: 'line' },
                  { id: 'te', label: 'trailing-edge flap', points: sketchCurve(-10, 0.105, 13, 2.35), color: palette.signal.cyan, kind: 'line' },
                  { id: 'le', label: 'leading-edge slat', points: sketchCurve(-2, 0.1, 22, 2.05), color: palette.signal.violet, kind: 'line' },
                  { id: 'both', label: 'slat + flap', points: sketchCurve(-10, 0.1, 20, 2.95), color: palette.signal.lime, kind: 'line', dash: '5 3' },
                ]}
                footer="Shapes only, for high-Reynolds-number wings: trailing-edge flaps shift the curve up (more negative zero-lift angle) and usually stall slightly earlier; leading-edge devices extend the curve to higher angles. Not data, and not computed by this simulator."
              />
            </div>
          </div>

          <details className="panel p-4">
            <summary className="cursor-pointer font-display text-base font-semibold text-signal-violet">Advanced: why slots work (Smith, 1975)</summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-slate-300">
              <li><b>Slat effect.</b> An upstream element's circulation lowers the velocities near the leading edge of the element behind it, reducing that element's suction peak and the pressure recovery it must achieve.</li>
              <li><b>Circulation effect.</b> A downstream element puts the trailing edge of the upstream element in a region of high velocity; to leave its trailing edge smoothly, the upstream element must carry more circulation, so it lifts more.</li>
              <li><b>Dumping effect.</b> Because the upstream element's trailing-edge velocity is high, its boundary layer leaves the surface at a higher speed, so less pressure recovery takes place on it and separation is relieved.</li>
              <li><b>Off-the-surface pressure recovery.</b> The wake of the upstream element completes its pressure recovery away from any wall, which is more efficient than recovery in contact with a surface.</li>
              <li><b>Fresh boundary layer.</b> Each element starts a new, thin boundary layer, which tolerates a stronger adverse pressure gradient than one thick layer would.</li>
            </ul>
            <p className="mt-3 text-[12px] text-slate-500">A. M. O. Smith, "High-Lift Aerodynamics", Journal of Aircraft 12(6), 1975. Smith showed that the gap flow is not a "high-energy jet" that re-energises the boundary layer; these five effects explain the gain.</p>
          </details>
        </div>
      </div>
    </div>
  );
}
