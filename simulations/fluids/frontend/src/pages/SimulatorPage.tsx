import { useEffect, useMemo, useState } from 'react';
import { palette } from '@eduphysics/ui';
import type { AirfoilInfo, LoadedCase, Manifest } from '../data/types';
import { anglesFor, neighbours, resolve, reynoldsFor, airfoilsWithData } from '../data/selection';
import { prefetch } from '../data/loader';
import { useCase } from '../hooks/useCase';
import { hrefFor } from '../hooks/useRoute';
import { outlineLab } from '../physics/geometry';
import { thinAirfoilCl } from '../physics/theory';
import { airfoilText, camberPrimer } from '../content/airfoils';
import { explain, type Insight } from '../content/explain';
import { FlowCanvas, VIEW_INFO, VIEWPORTS, type FieldView } from '../components/FlowCanvas';
import { CfPlot, CpPlot, DragCurve, HistoryPlot, LiftCurve } from '../components/plots';
import { AirfoilShape } from '../components/AirfoilShape';
import { FlowBadge, SourceTag, flowClassInfo } from '../components/Badge';
import { SnapSlider } from '../components/SnapSlider';
import { Rich } from '../components/Rich';

type Frame = keyof typeof VIEWPORTS;

/** Which view best shows each explanation (the "show me" buttons). */
const INSIGHT_VIEW: Partial<Record<Insight['id'], { view: FieldView; frame: Frame; label: string }>> = {
  'boundary-layer': { view: 'speed', frame: 'airfoil', label: 'Show the velocity field' },
  stagnation: { view: 'pressure', frame: 'airfoil', label: 'Show pressure near the nose' },
  separation: { view: 'vorticity', frame: 'airfoil', label: 'Show vorticity' },
  regime: { view: 'vorticity', frame: 'wake', label: 'Show the wake' },
};

function Toggle({ pressed, onClick, children, title }: { pressed: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return <button type="button" className="btn-toggle" aria-pressed={pressed} onClick={onClick} title={title}>{children}</button>;
}

function AirfoilPicker({ airfoils, value, onChange }: { airfoils: AirfoilInfo[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Airfoil" className="grid grid-cols-2 gap-2">
      {airfoils.map((a) => (
        <button key={a.id} type="button" role="radio" aria-checked={a.id === value} onClick={() => onChange(a.id)}
          className={`rounded-lg border p-2 text-left transition ${a.id === value ? 'border-signal-amber/70 bg-signal-amber/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
          <AirfoilShape airfoil={a} width={118} />
          <div className="mt-1 text-xs font-semibold text-slate-100">{a.name}</div>
          <div className="text-[10px] leading-tight text-slate-400">{airfoilText[a.id]?.tagline}</div>
        </button>
      ))}
    </div>
  );
}

function Coefficient({ label, value, sub, title }: { label: React.ReactNode; value: string; sub?: string; title?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-space-950/60 px-3 py-2" title={title}>
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="font-mono text-lg text-slate-100">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Readouts({ loaded, airfoil }: { loaded: LoadedCase; airfoil: AirfoilInfo }) {
  const { coefficients: c, flow, aoa_deg } = loaded.record;
  const theory = thinAirfoilCl(aoa_deg, airfoil.theory.alpha_l0_deg);
  const avg = !flow.steady ? 'time average' : undefined;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <Coefficient label={<>C<sub>L</sub> (CFD)</>} value={c.cl.toFixed(3)} sub={c.cl_min !== undefined ? `range ${c.cl_min.toFixed(3)} … ${c.cl_max!.toFixed(3)}` : avg} />
      <Coefficient label={<>C<sub>L</sub> thin-airfoil theory</>} value={theory.toFixed(3)} sub="inviscid, attached flow" />
      <Coefficient label={<>C<sub>D</sub> (CFD)</>} value={c.cd.toFixed(3)} sub={`friction ${c.cd_friction.toFixed(3)} · pressure ${c.cd_pressure.toFixed(3)}`} />
      <Coefficient label={<>C<sub>m,c/4</sub> (CFD)</>} value={c.cm.toFixed(3)} sub={`theory ${airfoil.theory.cm_quarter_chord.toFixed(3)}`} />
      <Coefficient label="L / D" value={(c.cl / c.cd).toFixed(2)} sub={avg} />
      <Coefficient label="Strouhal St = fc/U∞" value={flow.strouhal && flow.class === 'periodic' ? flow.strouhal.toFixed(3) : '—'} sub={flow.class === 'periodic' ? 'vortex shedding' : 'no periodic shedding'} />
    </div>
  );
}

function MarkerLegend({ averaged, shown }: { averaged: boolean; shown: boolean }) {
  const item = (color: string, shape: 'diamond' | 'dot' | 'ring' | 'x', text: string) => (
    <span className="inline-flex items-center gap-1.5">
      <svg width="12" height="12" aria-hidden="true">
        {shape === 'diamond' && <path d="M6 0 L12 6 L6 12 L0 6 Z" fill={color} />}
        {shape === 'dot' && <circle cx="6" cy="6" r="4.5" fill={color} />}
        {shape === 'ring' && <><circle cx="6" cy="6" r="4.5" fill="none" stroke={color} strokeWidth="2" /><circle cx="6" cy="6" r="1.4" fill={color} /></>}
        {shape === 'x' && <path d="M1 1 L11 11 M11 1 L1 11" stroke={color} strokeWidth="2" />}
      </svg>
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
      {item(palette.signal.amber, 'diamond', 'S: stagnation (attachment) point on the wall')}
      {item(palette.signal.rose, 'dot', 'Sep: separation (C_f = 0)')}
      {item(palette.signal.teal, 'dot', 'R: reattachment')}
      {item(palette.signal.cyan, 'x', 'free stagnation point (saddle, u = 0)')}
      {item(palette.signal.violet, 'ring', 'eddy centre')}
      {!shown && <span className="text-slate-500">— markers belong to the {averaged ? 'time-averaged' : 'steady'} flow; switch to it to see them</span>}
    </div>
  );
}

export function SimulatorPage({ manifest, params, go }: { manifest: Manifest; params: URLSearchParams; go: (hash: string, replace?: boolean) => void }) {
  const selection = resolve(manifest, { airfoil: params.get('airfoil'), reynolds: Number(params.get('re') ?? 500), aoa: Number(params.get('aoa') ?? 4) });
  const view = (params.get('view') as FieldView) in VIEW_INFO ? (params.get('view') as FieldView) : 'speed';
  const frame: Frame = params.get('frame') === 'wake' ? 'wake' : 'airfoil';
  const [streamlines, setStreamlines] = useState(true);
  const [contours, setContours] = useState(false);
  const [allRe, setAllRe] = useState(false);
  const [split, setSplit] = useState(true);
  const [snapshot, setSnapshot] = useState(false);
  const [seeds, setSeeds] = useState<[number, number][]>([]);
  const { loaded, loading, error } = useCase(selection?.summary.id ?? null);

  const set = (patch: Record<string, string | number>) => {
    const next = { airfoil: selection?.airfoil ?? '0012', re: selection?.reynolds ?? 500, aoa: selection?.aoa ?? 0, view, frame, ...patch };
    go(hrefFor('simulator', next), true);
  };

  const selectedId = selection?.summary.id;
  const neighbourIds = selection ? neighbours(manifest, selection).join(',') : '';
  useEffect(() => { setSeeds([]); }, [selectedId]);
  useEffect(() => { if (neighbourIds) prefetch(neighbourIds.split(',')); }, [neighbourIds]);

  const shown = loaded;                                  // the previous case stays visible while the next loads
  const airfoil = manifest.airfoils.find((a) => a.id === (shown?.record.airfoil ?? selection?.airfoil))!;
  const outline = useMemo(() => (shown ? outlineLab(airfoil.outline, shown.record.aoa_deg) : []), [shown, airfoil]);
  const insights = useMemo(() => (shown ? explain(shown.record, airfoil, manifest.cases) : []), [shown, airfoil, manifest.cases]);

  if (!selection) return <p className="p-6 text-slate-300">No computed cases are available yet. Generate the dataset with the Python backend (see the README).</p>;
  const record = shown?.record;
  const averaged = record ? !record.flow.steady : false;
  const lastState = record ? record.surface.states.length - 1 : 0;
  const stateIndex = averaged && snapshot ? 0 : lastState;
  const markersShown = stateIndex === lastState;
  const text = airfoilText[selection.airfoil];

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:p-6">
      <aside className="space-y-4" aria-label="Simulation controls">
        <section className="panel space-y-3 p-3">
          <h2 className="label">Airfoil</h2>
          <AirfoilPicker airfoils={manifest.airfoils.filter((a) => airfoilsWithData(manifest).includes(a.id))} value={selection.airfoil} onChange={(id) => set({ airfoil: id })} />
          <details className="text-xs leading-relaxed text-slate-300">
            <summary className="cursor-pointer text-slate-200">About {airfoil.name}: camber and thickness</summary>
            <p className="mt-2">{text?.naming}</p>
            <p className="mt-2">{text?.character}</p>
            <p className="mt-2 text-slate-400">{camberPrimer}</p>
          </details>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-slate-500">max thickness</dt><dd className="text-right font-mono text-slate-200">{(100 * airfoil.thickness_ratio).toFixed(0)}% at {(100 * airfoil.max_thickness_x).toFixed(0)}%c</dd>
            <dt className="text-slate-500">max camber</dt><dd className="text-right font-mono text-slate-200">{airfoil.max_camber > 0 ? `${(100 * airfoil.max_camber).toFixed(2)}% at ${(100 * airfoil.max_camber_x!).toFixed(0)}%c` : 'none'}</dd>
            <dt className="text-slate-500">LE radius</dt><dd className="text-right font-mono text-slate-200">{(100 * airfoil.leading_edge_radius).toFixed(2)}%c</dd>
            <dt className="text-slate-500">α_L0 (theory)</dt><dd className="text-right font-mono text-slate-200">{airfoil.theory.alpha_l0_deg.toFixed(2)}°</dd>
          </dl>
        </section>

        <section className="panel space-y-4 p-3">
          <SnapSlider label="Reynolds number Re = U∞c/ν" values={reynoldsFor(manifest, selection.airfoil)} value={selection.reynolds}
            onChange={(re) => set({ re })} format={(v) => v.toLocaleString('en')}
            help="Ratio of inertial to viscous forces. Lower Re: thicker boundary layers, more viscous drag." />
          <SnapSlider label="Angle of attack α" values={anglesFor(manifest, selection.airfoil, selection.reynolds)} value={selection.aoa}
            onChange={(aoa) => set({ aoa })} format={(v) => `${v}°`}
            help="Nose-up pitch relative to the free stream, about the leading edge." />
          <p className="text-[10px] leading-snug text-slate-500">Each stop is a separate Navier–Stokes simulation. Values between stops are not interpolated.</p>
        </section>

        <section className="panel space-y-3 p-3">
          <h2 className="label">Field</h2>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(VIEW_INFO) as FieldView[]).map((v) => <Toggle key={v} pressed={view === v} onClick={() => set({ view: v })}>{VIEW_INFO[v].label}</Toggle>)}
          </div>
          <p className="text-[11px] leading-snug text-slate-400">{VIEW_INFO[view].help}</p>
          <h2 className="label pt-1">Overlays &amp; framing</h2>
          <div className="flex flex-wrap gap-1.5">
            <Toggle pressed={streamlines} onClick={() => setStreamlines(!streamlines)}>Streamlines</Toggle>
            <Toggle pressed={contours} onClick={() => setContours(!contours)}>Iso-lines</Toggle>
            <Toggle pressed={frame === 'airfoil'} onClick={() => set({ frame: 'airfoil' })}>Near airfoil</Toggle>
            <Toggle pressed={frame === 'wake'} onClick={() => set({ frame: 'wake' })}>With wake</Toggle>
          </div>
          {averaged && (
            <div className="space-y-1.5">
              <h2 className="label pt-1">Unsteady flow</h2>
              <div className="flex flex-wrap gap-1.5">
                <Toggle pressed={!snapshot} onClick={() => setSnapshot(false)}>Time average</Toggle>
                <Toggle pressed={snapshot} onClick={() => setSnapshot(true)}>Final snapshot</Toggle>
              </div>
              <p className="text-[10px] leading-snug text-slate-500">Streamlines of a snapshot are instantaneous streamlines, not particle paths.</p>
            </div>
          )}
          <p className="text-[11px] text-slate-400">Click the flow to trace a streamline through that point.{seeds.length > 0 && <button type="button" className="link ml-1" onClick={() => setSeeds([])}>Clear {seeds.length}</button>}</p>
        </section>
      </aside>

      <main className="min-w-0 space-y-4">
        <section className="panel p-3" aria-labelledby="flow-heading">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h1 id="flow-heading" className="font-display text-lg font-semibold text-slate-100">
              {airfoil.name} · Re {selection.reynolds.toLocaleString('en')} · α {selection.aoa}°
            </h1>
            <div className="flex items-center gap-2">
              {loading && <span className="text-xs text-slate-400" role="status">loading…</span>}
              {record && <FlowBadge kind={record.flow.class} />}
              <SourceTag kind="cfd" />
            </div>
          </div>
          {error && <p className="mb-2 rounded border border-signal-rose/40 bg-signal-rose/10 p-2 text-sm text-signal-rose">{error}</p>}
          {shown ? (
            <>
              <FlowCanvas loaded={shown} stateIndex={stateIndex} view={view} viewport={VIEWPORTS[frame]} outline={outline}
                showStreamlines={streamlines} showContours={contours}
                wallPoints={markersShown ? shown.record.wall_points : null} fieldPoints={markersShown ? shown.record.field_points : null}
                seeds={seeds} onAddSeed={(x, y) => setSeeds((s) => [...s.slice(-11), [x, y]])} />
              <div className="mt-2"><MarkerLegend averaged={averaged} shown={markersShown} /></div>
              {record && <p className="mt-1 text-[11px] text-slate-500">{flowClassInfo[record.flow.class].help}</p>}
            </>
          ) : (
            <div className="grid aspect-[15/8] place-items-center rounded-lg border border-white/10 text-sm text-slate-400">Loading flow field…</div>
          )}
        </section>

        {shown && <Readouts loaded={shown} airfoil={airfoil} />}

        {shown && record && (
          <div className="grid gap-4 xl:grid-cols-2">
            <CpPlot record={record} stateIndex={stateIndex} />
            <CfPlot record={record} stateIndex={stateIndex} />
            <div>
              <LiftCurve cases={manifest.cases} airfoil={airfoil} reynolds={selection.reynolds} aoa={selection.aoa} allRe={allRe}
                onSelect={(aoa, re) => set({ aoa, re })} />
              <div className="mt-1.5 flex gap-1.5"><Toggle pressed={allRe} onClick={() => setAllRe(!allRe)}>Compare all Reynolds numbers</Toggle></div>
            </div>
            <div>
              <DragCurve cases={manifest.cases} airfoil={airfoil} reynolds={selection.reynolds} aoa={selection.aoa} split={split}
                onSelect={(aoa, re) => set({ aoa, re })} />
              <div className="mt-1.5 flex gap-1.5"><Toggle pressed={split} onClick={() => setSplit(!split)}>Friction / pressure split</Toggle></div>
            </div>
          </div>
        )}

        {shown && record && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section className="panel p-4" aria-labelledby="explain-heading">
              <h2 id="explain-heading" className="font-display text-base font-semibold text-slate-100">What the simulation shows</h2>
              <div className="mt-3 space-y-3">
                {insights.map((ins) => {
                  const action = INSIGHT_VIEW[ins.id];
                  return (
                    <article key={ins.id} className="rounded-lg border border-white/10 bg-space-950/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-200">{ins.title}</h3>
                        {action && <button type="button" className="link text-[11px]" onClick={() => set({ view: action.view, frame: action.frame })}>{action.label}</button>}
                      </div>
                      <p className="mt-1 text-[13px] leading-relaxed text-slate-300"><Rich text={ins.text} /></p>
                    </article>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-slate-400">The equations and ideas behind these explanations are in <a className="link" href={hrefFor('theory')}>Theory</a>.</p>
            </section>
            <div className="space-y-4">
              <HistoryPlot record={record} />
              <section className="panel p-3 text-[11px] leading-relaxed text-slate-400" aria-label="How this case was computed">
                <h2 className="label mb-1">How this case was computed</h2>
                <p>2D incompressible Navier–Stokes, cut-cell finite volumes on a {record.solver.nx} × {record.solver.ny} stretched grid
                  (wall spacing {record.solver.wall_spacing}c, domain {record.solver.upstream}c upstream, {record.solver.downstream}c downstream, ±{record.solver.lateral}c).
                  {' '}{record.solver.steps.toLocaleString('en')} time steps to t = {record.flow.time.toFixed(1)} c/U∞ (final Δt = {record.solver.final_dt.toExponential(2)}).
                  Laminar and two-dimensional by construction: no turbulence model and no spanwise (3D) instability.</p>
                <p className="mt-1">The coloured field is resampled onto a uniform {record.field.spacing}c grid for display; forces, C<sub>p</sub> and C<sub>f</sub> come from the solver data directly.</p>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
