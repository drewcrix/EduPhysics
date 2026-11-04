// Diagnostics plots. Every plot shows one dimension at a time with explicit units;
// per-axis bands use χ²₁ (they are *marginal* statements), NIS/NEES bounds use χ² with the
// matching degrees of freedom.
import { useMemo, useState } from 'react';
import { Chart, type Series } from './Chart';
import { SensorTimeline } from './SensorTimeline';
import type { HistoryColumns, InnovationColumns } from '../sim/layout';
import type { Meta } from '../sim/types';
import type { PlotId } from '../sim/useMission';
import { errorUnit, stateUnit } from '../sim/units';

export interface Chi2Table {
  get(p: number, k: number): number;
}

interface Props {
  meta: Meta;
  history: HistoryColumns;
  innovations: InnovationColumns;
  version: number;
  truthVisible: boolean;
  confidence: number;
  chi2: Chi2Table;
  active: PlotId;
  onActive: (p: PlotId) => void;
  highlights: Set<string>;
}

const TABS: { id: PlotId; label: string; needsTruth?: boolean }[] = [
  { id: 'errors', label: 'Errors' },
  { id: 'states', label: 'States' },
  { id: 'uncertainty', label: 'Uncertainty' },
  { id: 'innovations', label: 'Innovations' },
  { id: 'nis', label: 'NIS' },
  { id: 'nees', label: 'NEES', needsTruth: true },
  { id: 'sensors', label: 'Sensors' },
  { id: 'controls', label: 'Controls' },
];

const C = { truth: '#2dd4bf', est: '#fbbf24', band: 'rgba(56,225,255,0.14)', bandLine: 'rgba(56,225,255,0.55)', err: '#f8fafc', prior: '#a78bfa' };
const SENSOR_COLORS = ['#38e1ff', '#fbbf24', '#a3e635', '#fb7185', '#a78bfa', '#2dd4bf'];

function groups(meta: Meta) {
  const g = [{ label: 'Position', idx: [0, 1, 2] }, { label: 'Velocity', idx: [3, 4, 5] }];
  if (meta.model === 'rigid12') g.push({ label: 'Attitude', idx: [6, 7, 8] }, { label: 'Body rates', idx: [9, 10, 11] });
  return g;
}

export function PlotPanel(p: Props) {
  const { meta, history: h, innovations: inn, truthVisible, confidence, chi2 } = p;
  const [group, setGroup] = useState(0);
  const [sensor, setSensor] = useState(0);
  const k1 = Math.sqrt(chi2.get(confidence, 1));
  const n = meta.layout.stateDim;
  const pct = Math.round(confidence * 100);
  const g = groups(meta)[Math.min(group, groups(meta).length - 1)];

  const body = useMemo(() => {
    const x = h.t;
    const charts: JSX.Element[] = [];
    if (p.active === 'states' || p.active === 'errors') {
      for (const i of g.idx) {
        const lab = meta.stateLabels[i];
        if (p.active === 'states') {
          const u = stateUnit(lab);
          const s: Series[] = [{ label: 'estimate', color: C.est, values: h.xEst[i].map((v) => v * u.scale) }];
          if (truthVisible) s.unshift({ label: 'truth', color: C.truth, values: h.xTrue[i].map((v) => v * u.scale) });
          charts.push(<Chart key={`s${i}`} title={`${lab.name}`} x={x} series={s} yLabel={`${lab.name} [${u.unit}]`} />);
        } else {
          const u = errorUnit(lab);
          const up = h.sigma[i].map((v) => k1 * v * u.scale);
          const lo = up.map((v) => -v);
          const s: Series[] = [
            { label: `+${pct}% per-axis (±${k1.toFixed(2)}σ)`, color: C.bandLine, values: up, width: 1 },
            { label: `−${pct}%`, color: C.bandLine, values: lo, width: 1 },
          ];
          if (truthVisible) s.push({ label: 'error (truth − estimate)', color: C.err, values: h.err[i].map((v) => v * u.scale) });
          charts.push(<Chart key={`e${i}`} title={`${lab.name} error${lab.quantity === 'angle' ? ' (wrapped to ±180°)' : ''}`} x={x} series={s} bands={[[1, 2, C.band]]} yLabel={`[${u.unit}]`} />);
        }
      }
    } else if (p.active === 'uncertainty') {
      const rtn = meta.model === 'cw6' ? ['radial', 'along-track', 'cross-track'] : ['R (radial)', 'T (along-track)', 'N (cross-track)'];
      charts.push(
        <Chart key="u" title="1σ position uncertainty by direction" x={x} logY yLabel="σ [m]" height={230}
          series={[0, 1, 2].map((j) => ({ label: rtn[j], color: ['#fb7185', '#fbbf24', '#38e1ff'][j], values: h.sigmaRtn[j].map((v) => Math.max(v, 1e-6)) }))} />,
        <Chart key="v" title="1σ velocity uncertainty (per axis)" x={x} logY yLabel="σ [m/s]"
          series={[3, 4, 5].map((j, c) => ({ label: meta.stateLabels[j].name, color: ['#fb7185', '#fbbf24', '#38e1ff'][c], values: h.sigma[j].map((v) => Math.max(v, 1e-9)) }))} />,
      );
      if (truthVisible)
        charts.push(<Chart key="rtnerr" title="Position error in RTN" x={x} yLabel="[m]"
          series={[0, 1, 2].map((j) => ({ label: rtn[j], color: ['#fb7185', '#fbbf24', '#38e1ff'][j], values: h.errRtn[j] }))} />);
    } else if (p.active === 'innovations') {
      const sm = meta.sensors[sensor];
      if (sm) {
        const idx = inn.sensor.map((s, i) => (s === sensor ? i : -1)).filter((i) => i >= 0);
        const xi = idx.map((i) => inn.t[i]);
        for (let c = 0; c < sm.dim; c++) {
          const lab = sm.labels[c];
          const u = errorUnit(lab);
          const up = idx.map((i) => k1 * inn.sigma[c][i] * u.scale);
          charts.push(
            <Chart key={`i${sensor}-${c}`} title={`${sm.name}: ${lab.name} innovation ν = z − h(x̂⁻)`} x={xi} bands={[[1, 2, C.band]]} yLabel={`[${u.unit}]`}
              series={[
                { label: `+${pct}% of S`, color: C.bandLine, values: up, width: 1 },
                { label: `−${pct}%`, color: C.bandLine, values: up.map((v) => -v), width: 1 },
                { label: 'ν', color: SENSOR_COLORS[sensor % 6], values: idx.map((i) => inn.nu[c][i] * u.scale), points: true },
              ]} />,
          );
        }
        if (!idx.length) charts.push(<p key="none" className="p-3 text-sm text-slate-400">No measurements from {sm.name} yet.</p>);
      }
    } else if (p.active === 'nis') {
      const dims = [...new Set(inn.dim)].sort();
      const series: Series[] = meta.sensors.map((sm, s) => ({ label: sm.name, color: SENSOR_COLORS[s % 6], points: true, values: inn.sensor.map((v, i) => (v === s ? Math.max(inn.nis[i], 1e-4) : null)) }));
      for (const d of dims)
        series.push(
          { label: `χ²${d} 2.5%`, color: 'rgba(148,163,184,0.6)', dash: [4, 4], width: 1, values: inn.t.map(() => chi2.get(0.025, d)) },
          { label: `χ²${d} 97.5%`, color: 'rgba(148,163,184,0.6)', dash: [4, 4], width: 1, values: inn.t.map(() => chi2.get(0.975, d)) },
        );
      charts.push(<Chart key="nis" title="Normalised innovation squared νᵀS⁻¹ν" x={inn.t} logY series={series} yLabel="NIS" height={260} />);
      charts.push(<Caveat key="c" text="If the filter is consistent and errors are Gaussian, NIS follows χ² with dim(z) degrees of freedom: ~95% of points should lie between the dashed lines. A few outside is normal; a run of points outside means a mis-tuned R or Q, or a wrong model." />);
    } else if (p.active === 'nees') {
      if (!truthVisible) charts.push(<p key="h" className="p-3 text-sm text-slate-400">NEES needs the true state, which is hidden until the debrief.</p>);
      else {
        charts.push(
          <Chart key="nees" title="Normalised estimation error squared eᵀP⁻¹e" x={x} logY yLabel="NEES" height={260}
            series={[
              { label: 'NEES', color: C.err, values: h.nees.map((v) => (Number.isFinite(v) ? Math.max(v, 1e-4) : null)) },
              { label: `χ²${n} 2.5%`, color: 'rgba(148,163,184,0.7)', dash: [4, 4], width: 1, values: x.map(() => chi2.get(0.025, n)) },
              { label: `χ²${n} 97.5%`, color: 'rgba(148,163,184,0.7)', dash: [4, 4], width: 1, values: x.map(() => chi2.get(0.975, n)) },
            ]} />,
          <Caveat key="c" text={`NEES uses the truth, so it exists only in simulation. For a consistent Gaussian filter it follows χ²${n}. Successive values are correlated in time, so this plot is a qualitative check; the rigorous test averages independent Monte-Carlo runs (see docs/VALIDATION.md). The particle filter's belief may be non-Gaussian, so treat its NEES with extra care.`} />,
        );
      }
    } else if (p.active === 'controls') {
      for (let c = 0; c < meta.layout.controlDim; c++) {
        const lab = meta.controlLabels[c];
        charts.push(<Chart key={`u${c}`} title={`Control ${lab.name}`} x={x} yLabel={`[${lab.unit}]`}
          series={[{ label: 'actual (truth)', color: C.truth, values: h.uActual[c] }, { label: 'measured (telemetry)', color: C.est, values: h.uMeasured[c], dash: [3, 3] }]} />);
      }
      charts.push(<Caveat key="c" text="Commanded, actual and measured controls are distinct: the actuator may over/under-perform (actual ≠ commanded) and the filter only sees noisy telemetry (measured). Controls are held constant over each step (zero-order hold)." />);
    }
    return charts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.version, p.active, group, sensor, truthVisible, confidence, k1, g]);

  return (
    <section className={`panel flex min-h-0 flex-col ${p.highlights.has(`plot:${p.active}`) ? 'highlight-ring' : ''}`} aria-label="Diagnostics plots">
      <div role="tablist" aria-label="Plot type" className="flex flex-wrap gap-1 border-b border-white/5 px-2 pt-2">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={p.active === t.id}
            className={`rounded-t-md px-2.5 py-1 text-xs font-medium ${p.active === t.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'} ${p.highlights.has(`plot:${t.id}`) ? 'highlight-ring' : ''}`}
            onClick={() => p.onActive(t.id)}>
            {t.label}{t.needsTruth && !truthVisible ? ' 🔒' : ''}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
        {(p.active === 'states' || p.active === 'errors') && groups(meta).map((gg, i) => (
          <button key={gg.label} className={`chip ${group === i ? 'border-signal-cyan/50 text-white' : ''}`} onClick={() => setGroup(i)} aria-pressed={group === i}>{gg.label}</button>
        ))}
        {p.active === 'innovations' && meta.sensors.map((s, i) => (
          <button key={s.id} className={`chip ${sensor === i ? 'border-signal-cyan/50 text-white' : ''}`} onClick={() => setSensor(i)} aria-pressed={sensor === i}>{s.name}</button>
        ))}
        {(p.active === 'errors' || p.active === 'innovations') && (
          <span className="text-slate-500">Shaded band: per-axis {pct}% (±√χ²₁ = ±{k1.toFixed(2)}σ) — a marginal bound, not the joint 3-D region.</span>
        )}
        {p.active === 'errors' && !truthVisible && <span className="text-amber-300">Truth hidden: only the claimed uncertainty is shown.</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {p.active === 'sensors' ? <div className="p-2"><SensorTimeline meta={meta} history={h} version={p.version} /></div>
          : <div className="grid gap-2 xl:grid-cols-2">{body}</div>}
      </div>
    </section>
  );
}

function Caveat({ text }: { text: string }) {
  return <p className="col-span-full rounded-md border border-white/5 bg-white/5 p-2 text-[11px] leading-relaxed text-slate-400">{text}</p>;
}
