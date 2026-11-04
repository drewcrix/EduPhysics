import { useMemo, useRef, useState, type ReactNode } from 'react';
import { palette } from '@eduphysics/ui';
import { Rich } from './Rich';

export interface Series {
  id: string;
  label: string;
  points: [number, number][];
  color: string;
  kind?: 'line' | 'markers' | 'both';
  dash?: string;
  width?: number;
  /** Per-point hollow markers (e.g. time-averaged unsteady results). */
  hollow?: boolean[];
  /** Per-point vertical range (e.g. min-max of an unsteady coefficient). */
  ranges?: ([number, number] | null)[];
  opacity?: number;
}

export interface ChartProps {
  title: ReactNode;
  xLabel: ReactNode;
  yLabel: ReactNode;
  series: Series[];
  xDomain?: [number, number];
  yDomain?: [number, number];
  invertY?: boolean;
  vlines?: { x: number; color: string; label?: string; dash?: string }[];
  hlines?: { y: number; color: string; label?: string; dash?: string }[];
  shade?: { x0: number; x1: number; color: string }[];
  onPointClick?: (seriesId: string, index: number) => void;
  footer?: ReactNode;
  ariaLabel: string;
  height?: number;
}

const W = 520;
const M = { l: 48, r: 12, t: 10, b: 34 };

export function niceTicks(lo: number, hi: number, target = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9 * step; v += step) ticks.push(Number(v.toPrecision(10)));
  return ticks;
}

function extent(values: number[], pad = 0.06): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  let lo = Math.min(...finite), hi = Math.max(...finite);
  if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
  const d = (hi - lo) * pad;
  return [lo - d, hi + d];
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Number(v.toPrecision(3)).toString());

/** Small dependency-free SVG chart: lines, markers, range bars, reference lines, click-to-select. */
export function Chart({ title, xLabel, yLabel, series, xDomain, yDomain, invertY, vlines = [], hlines = [], shade = [], onPointClick, footer, ariaLabel, height = 250 }: ChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ s: Series; i: number } | null>(null);
  const H = height;
  const [x0, x1] = useMemo(() => xDomain ?? extent(series.flatMap((s) => s.points.map((p) => p[0])), 0.03), [xDomain, series]);
  const [y0, y1] = useMemo(() => yDomain ?? extent([...series.flatMap((s) => s.points.map((p) => p[1])), ...series.flatMap((s) => (s.ranges ?? []).flatMap((r) => (r ? r : [])))]), [yDomain, series]);
  const px = (x: number) => M.l + ((x - x0) / (x1 - x0)) * (W - M.l - M.r);
  const py = (y: number) => (invertY ? M.t + ((y - y0) / (y1 - y0)) * (H - M.t - M.b) : H - M.b - ((y - y0) / (y1 - y0)) * (H - M.t - M.b));
  const clip = `clip-${ariaLabel.replace(/\W/g, '')}`;

  const onMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * W;
    const my = ((e.clientY - r.top) / r.height) * H;
    let best: { s: Series; i: number } | null = null;
    let bestDistance = 18;
    for (const s of series) {
      if (s.kind === 'line') continue;
      for (let i = 0; i < s.points.length; i++) {
        const d = Math.hypot(px(s.points[i][0]) - mx, py(s.points[i][1]) - my);
        if (d < bestDistance) { bestDistance = d; best = { s, i }; }
      }
    }
    setHover(best);
  };

  return (
    <figure className="panel flex flex-col p-3">
      <figcaption className="mb-1 flex items-center justify-between gap-2 text-xs font-semibold text-slate-300">{title}</figcaption>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label={ariaLabel}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onClick={() => hover && onPointClick?.(hover.s.id, hover.i)} style={{ cursor: hover && onPointClick ? 'pointer' : 'default' }}>
        <defs><clipPath id={clip}><rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} /></clipPath></defs>
        {shade.map((s, i) => <rect key={i} x={px(s.x0)} y={M.t} width={Math.max(0, px(s.x1) - px(s.x0))} height={H - M.t - M.b} fill={s.color} />)}
        {niceTicks(x0, x1).map((t) => (
          <g key={`x${t}`}>
            <line x1={px(t)} x2={px(t)} y1={M.t} y2={H - M.b} stroke={palette.grid} />
            <text x={px(t)} y={H - M.b + 13} textAnchor="middle" fontSize="10" fill={palette.text.muted}>{fmt(t)}</text>
          </g>
        ))}
        {niceTicks(Math.min(y0, y1), Math.max(y0, y1)).map((t) => (
          <g key={`y${t}`}>
            <line x1={M.l} x2={W - M.r} y1={py(t)} y2={py(t)} stroke={palette.grid} />
            <text x={M.l - 5} y={py(t) + 3} textAnchor="end" fontSize="10" fill={palette.text.muted}>{fmt(t)}</text>
          </g>
        ))}
        <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} fill="none" stroke="rgba(148,163,184,0.3)" />
        <g clipPath={`url(#${clip})`}>
          {hlines.map((l, i) => <line key={`h${i}`} x1={M.l} x2={W - M.r} y1={py(l.y)} y2={py(l.y)} stroke={l.color} strokeDasharray={l.dash ?? '4 4'} strokeWidth="1" />)}
          {vlines.map((l, i) => <line key={`v${i}`} x1={px(l.x)} x2={px(l.x)} y1={M.t} y2={H - M.b} stroke={l.color} strokeDasharray={l.dash ?? '3 3'} strokeWidth="1" />)}
          {series.map((s) => (
            <g key={s.id} opacity={s.opacity ?? 1}>
              {(s.ranges ?? []).map((r, i) => r && (
                <line key={i} x1={px(s.points[i][0])} x2={px(s.points[i][0])} y1={py(r[0])} y2={py(r[1])} stroke={s.color} strokeWidth="5" strokeOpacity="0.28" strokeLinecap="round" />
              ))}
              {s.kind !== 'markers' && s.points.length > 1 && (
                <polyline points={s.points.map((p) => `${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dash} strokeLinejoin="round" />
              )}
              {s.kind !== 'line' && s.points.map((p, i) => (
                <circle key={i} cx={px(p[0])} cy={py(p[1])} r={hover?.s.id === s.id && hover.i === i ? 4.6 : 3.4}
                  fill={s.hollow?.[i] ? palette.space[950] : s.color} stroke={s.color} strokeWidth="1.4" />
              ))}
            </g>
          ))}
        </g>
        {vlines.filter((l) => l.label).map((l, i) => <text key={`vl${i}`} x={px(l.x) + 3} y={M.t + 10} fontSize="9" fill={l.color}>{l.label}</text>)}
        {hlines.filter((l) => l.label).map((l, i) => <text key={`hl${i}`} x={W - M.r - 3} y={py(l.y) - 3} fontSize="9" textAnchor="end" fill={l.color}>{l.label}</text>)}
        <text x={(M.l + W - M.r) / 2} y={H - 4} textAnchor="middle" fontSize="11" fill={palette.text.body}>{xLabel}</text>
        <text transform={`translate(12 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill={palette.text.body}>{yLabel}</text>
        {hover && (() => {
          const p = hover.s.points[hover.i];
          const tx = Math.min(px(p[0]) + 8, W - 150);
          const ty = Math.max(py(p[1]) - 30, M.t + 2);
          return (
            <g pointerEvents="none">
              <rect x={tx} y={ty} width="142" height="22" rx="4" fill={palette.space[850]} stroke="rgba(255,255,255,0.15)" />
              <text x={tx + 6} y={ty + 15} fontSize="10" fill={palette.text.strong}>{hover.s.label}: ({fmt(p[0])}, {p[1].toFixed(3)})</text>
            </g>
          );
        })()}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
        {series.filter((s) => s.label).map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden="true"><line x1="0" x2="18" y1="4" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.kind === 'markers' ? '0.1 6' : s.dash} strokeLinecap="round" /></svg>
            <Rich text={s.label} />
          </span>
        ))}
      </div>
      {footer && <div className="mt-1.5 text-[11px] leading-snug text-slate-500">{typeof footer === 'string' ? <Rich text={footer} /> : footer}</div>}
    </figure>
  );
}
