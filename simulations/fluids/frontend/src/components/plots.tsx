import { palette } from '@eduphysics/ui';
import type { AirfoilInfo, CaseRecord, CaseSummary } from '../data/types';
import { assessStall, blasiusFrictionDrag, liftSlope, thinAirfoilCl } from '../physics/theory';
import { Chart, type Series } from './Chart';
import { SourceTag } from './Badge';

const UPPER = palette.signal.cyan;
const LOWER = palette.signal.amber;
const isAveraged = (c: CaseSummary) => c.class !== 'steady' && c.class !== 'nearly_steady';

/** Split the surface arrays into upper/lower curves sorted by x/c. */
function bySide(record: CaseRecord, values: number[]) {
  const s = record.surface;
  const pick = (upper: number) => s.station.map((x, i) => [x, values[i], s.upper[i]] as const)
    .filter((p) => p[2] === upper).map((p) => [p[0], p[1]] as [number, number]).sort((a, b) => a[0] - b[0]);
  return { upper: pick(1), lower: pick(0) };
}

export function CpPlot({ record, stateIndex }: { record: CaseRecord; stateIndex: number }) {
  const k = Math.min(stateIndex, record.surface.cp.length - 1);
  const { upper, lower } = bySide(record, record.surface.cp[k]);
  const stag = record.wall_points.find((p) => p.kind === 'stagnation');
  return (
    <Chart
      title={<><span>Surface pressure, C<sub>p</sub> vs x/c {record.surface.states[k] === 'mean' ? '(time average)' : record.flow.steady ? '' : '(instantaneous)'}</span><SourceTag kind="cfd" /></>}
      xLabel="x / c" yLabel="Cp (negative up)" invertY ariaLabel="Surface pressure coefficient"
      xDomain={[-0.02, 1.02]}
      series={[
        { id: 'upper', label: 'upper surface', points: upper, color: UPPER, kind: 'line' },
        { id: 'lower', label: 'lower surface', points: lower, color: LOWER, kind: 'line', dash: '5 3' },
      ]}
      hlines={[{ y: 0, color: 'rgba(148,163,184,0.5)', dash: '2 3' }, { y: 1, color: 'rgba(251,191,36,0.45)', label: 'Cp = 1 (inviscid stagnation)', dash: '6 4' }]}
      vlines={stag ? [{ x: stag.station, color: palette.signal.amber, label: 'S' }] : []}
      footer="The area enclosed between the curves is the pressure normal-force coefficient, ∫(Cp,lower − Cp,upper) d(x/c), close to the pressure lift at small α. Behind the suction peak near the nose, Cp rises towards the trailing edge: an adverse pressure gradient the boundary layer must overcome."
    />
  );
}

export function CfPlot({ record, stateIndex }: { record: CaseRecord; stateIndex: number }) {
  const k = Math.min(stateIndex, record.surface.cf.length - 1);
  const { upper, lower } = bySide(record, record.surface.cf[k]);
  const marks = record.surface.states[k] === record.surface.states[record.surface.states.length - 1] ? record.wall_points : [];
  return (
    <Chart
      title={<><span>Skin friction, C<sub>f</sub> vs x/c</span><SourceTag kind="cfd" /></>}
      xLabel="x / c" yLabel="Cf" ariaLabel="Skin friction coefficient" xDomain={[-0.02, 1.02]}
      series={[
        { id: 'upper', label: 'upper surface', points: upper, color: UPPER, kind: 'line' },
        { id: 'lower', label: 'lower surface', points: lower, color: LOWER, kind: 'line', dash: '5 3' },
      ]}
      hlines={[{ y: 0, color: 'rgba(148,163,184,0.6)', dash: '2 3' }]}
      vlines={marks.filter((p) => p.kind === 'separation' || p.kind === 'reattachment').map((p) => ({
        x: p.station, color: p.kind === 'separation' ? palette.signal.rose : palette.signal.teal, label: p.kind === 'separation' ? 'Sep' : 'R',
      }))}
      footer="Cf = τw/(½ρU∞²), positive where the near-wall flow moves towards the trailing edge. Cf < 0 marks reversed (separated) flow; Cf = 0 marks separation and reattachment points, and the stagnation point near the nose."
    />
  );
}

function curvePoints(cases: CaseSummary[], key: 'cl' | 'cd') {
  const sorted = [...cases].sort((a, b) => a.aoa_deg - b.aoa_deg);
  return {
    sorted,
    points: sorted.map((c) => [c.aoa_deg, c[key]] as [number, number]),
    hollow: sorted.map(isAveraged),
    ranges: sorted.map((c) => (c[`${key}_min`] !== undefined ? [c[`${key}_min`]!, c[`${key}_max`]!] as [number, number] : null)),
  };
}

const RE_COLORS = [palette.signal.teal, palette.signal.violet, palette.signal.lime, palette.signal.rose, '#f472b6'];

export function LiftCurve({ cases, airfoil, reynolds, aoa, allRe, onSelect }: {
  cases: CaseSummary[]; airfoil: AirfoilInfo; reynolds: number; aoa: number; allRe: boolean; onSelect: (aoa: number, re: number) => void;
}) {
  const mine = cases.filter((c) => c.airfoil === airfoil.id && c.variant === 'baseline');
  const res = [...new Set(mine.map((c) => c.reynolds))].sort((a, b) => a - b);
  const selected = curvePoints(mine.filter((c) => c.reynolds === reynolds), 'cl');
  const angles = selected.points.map((p) => p[0]);
  const lo = Math.min(...angles, -4), hi = Math.max(...angles, 20);
  const series: Series[] = [
    { id: 'theory', label: 'thin-airfoil theory 2π(α − α_L0)', points: [[lo, thinAirfoilCl(lo, airfoil.theory.alpha_l0_deg)], [hi, thinAirfoilCl(hi, airfoil.theory.alpha_l0_deg)]], color: palette.signal.violet, kind: 'line', dash: '6 4' },
  ];
  if (allRe) {
    res.filter((r) => r !== reynolds).forEach((r, i) => {
      const c = curvePoints(mine.filter((x) => x.reynolds === r), 'cl');
      series.push({ id: `re${r}`, label: `CFD Re ${r}`, points: c.points, hollow: c.hollow, color: RE_COLORS[i % RE_COLORS.length], kind: 'both', width: 1, opacity: 0.55 });
    });
  }
  series.push({ id: `re${reynolds}`, label: `CFD Re ${reynolds}`, points: selected.points, hollow: selected.hollow, ranges: selected.ranges, color: palette.signal.cyan, kind: 'both', width: 2 });
  const stall = assessStall(selected.sorted.map((c) => ({ aoa: c.aoa_deg, cl: c.cl, clMin: c.cl_min, clMax: c.cl_max })));
  const slope = liftSlope(selected.sorted.filter((c) => !isAveraged(c)).map((c) => ({ aoa: c.aoa_deg, cl: c.cl })), -4.5, 4.5);
  const yMax = Math.max(1.0, ...selected.points.map((p) => p[1] + 0.15), ...selected.ranges.map((r) => (r ? r[1] + 0.05 : 0)));
  return (
    <Chart
      title={<><span>Lift curve, C<sub>L</sub> vs α · {airfoil.name}</span><span className="flex gap-1"><SourceTag kind="cfd" /><SourceTag kind="theory" /></span></>}
      xLabel="angle of attack α (deg)" yLabel="CL" ariaLabel="Lift coefficient versus angle of attack"
      xDomain={[lo - 1, hi + 1]}
      yDomain={[Math.min(-0.5, ...selected.points.map((p) => p[1] - 0.1), ...selected.ranges.map((r) => (r ? r[0] - 0.05 : 0))), Math.min(yMax, 2.3)]}
      series={series}
      vlines={[{ x: aoa, color: 'rgba(56,225,255,0.5)' }]}
      onPointClick={(id, i) => {
        if (id === 'theory') return;
        const re = Number(id.slice(2));
        const s = series.find((x) => x.id === id);
        if (s) onSelect(s.points[i][0], re);
      }}
      footer={<>
        Filled markers: steady solutions. Hollow markers: time averages of unsteady flow, with the bar spanning the C<sub>L</sub> oscillation. Click a point to load it.{' '}
        {slope !== null && <>Low-angle CFD lift slope: {slope.toFixed(2)} per rad ({Math.round((100 * slope) / (2 * Math.PI))}% of 2π). </>}
        {stall.kind === 'maximum' && <>The largest mean C<sub>L</sub> ({stall.cl.toFixed(2)}) occurs at α = {stall.aoa}° and falls by α = {stall.next}°: a lift maximum (stall) resolved by these angles.</>}
        {stall.kind === 'rising' && <>No lift maximum within the computed angles (largest mean C<sub>L</sub> {stall.cl.toFixed(2)} at α = {stall.aoa}°), so no stall angle is claimed.</>}
      </>}
    />
  );
}

export function DragCurve({ cases, airfoil, reynolds, aoa, split, onSelect }: {
  cases: CaseSummary[]; airfoil: AirfoilInfo; reynolds: number; aoa: number; split: boolean; onSelect: (aoa: number, re: number) => void;
}) {
  const mine = cases.filter((c) => c.airfoil === airfoil.id && c.variant === 'baseline' && c.reynolds === reynolds).sort((a, b) => a.aoa_deg - b.aoa_deg);
  const total = curvePoints(mine, 'cd');
  const series: Series[] = [
    { id: 'total', label: 'CFD total C_D', points: total.points, hollow: total.hollow, ranges: total.ranges, color: palette.signal.cyan, kind: 'both', width: 2 },
  ];
  if (split) {
    series.push({ id: 'friction', label: 'skin friction part', points: mine.map((c) => [c.aoa_deg, c.cd_friction]), color: palette.signal.teal, kind: 'both', dash: '4 3', width: 1.2 });
    series.push({ id: 'pressure', label: 'pressure part', points: mine.map((c) => [c.aoa_deg, c.cd_pressure]), color: palette.signal.rose, kind: 'both', dash: '4 3', width: 1.2 });
  }
  const blasius = blasiusFrictionDrag(reynolds);
  return (
    <Chart
      title={<><span>Drag, C<sub>D</sub> vs α · Re {reynolds}</span><SourceTag kind="cfd" /></>}
      xLabel="angle of attack α (deg)" yLabel="CD" ariaLabel="Drag coefficient versus angle of attack"
      yDomain={[0, Math.max(...mine.map((c) => c.cd_max ?? c.cd), blasius) * 1.12]}
      series={series}
      vlines={[{ x: aoa, color: 'rgba(56,225,255,0.5)' }]}
      hlines={[{ y: blasius, color: 'rgba(167,139,250,0.7)', label: `flat plate, laminar (Blasius): ${blasius.toFixed(3)}` }]}
      onPointClick={(id, i) => id === 'total' && onSelect(total.points[i][0], reynolds)}
      footer="Thin-airfoil theory predicts zero drag (d'Alembert's paradox for inviscid flow). Here drag is the integral of wall shear (friction) plus the streamwise pressure force (form drag). The dashed line is the analytical friction drag of a flat plate with laminar boundary layers on both sides, for scale."
    />
  );
}

export function HistoryPlot({ record }: { record: CaseRecord }) {
  const h = record.history;
  const w = record.flow.averaging_window;
  return (
    <Chart
      title={<><span>Force history after the impulsive start</span><SourceTag kind="cfd" /></>}
      xLabel="time t U∞ / c" yLabel="coefficient" ariaLabel="Lift and drag coefficient history"
      yDomain={[Math.min(0, ...h.cl.slice(20), ...h.cd.slice(20)) - 0.05, Math.max(...h.cl.slice(20), ...h.cd.slice(20)) + 0.08]}
      series={[
        { id: 'cl', label: 'C_L(t)', points: h.t.map((t, i) => [t, h.cl[i]]), color: palette.signal.cyan, kind: 'line', width: 1.3 },
        { id: 'cd', label: 'C_D(t)', points: h.t.map((t, i) => [t, h.cd[i]]), color: palette.signal.amber, kind: 'line', width: 1.3 },
      ]}
      shade={w ? [{ x0: w[0], x1: w[1], color: 'rgba(56,225,255,0.07)' }] : []}
      footer={w ? 'Shaded: the averaging window used for the reported means.' : `Converged at t = ${record.flow.time.toFixed(1)}: residual below 1e-4 and both coefficients changing by less than 1e-4 per unit time.`}
    />
  );
}
