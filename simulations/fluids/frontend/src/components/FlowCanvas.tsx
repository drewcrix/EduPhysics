import { useEffect, useMemo, useRef, useState } from 'react';
import { palette } from '@eduphysics/ui';
import type { FieldPoint, LoadedCase, WallPoint } from '../data/types';
import { colorAt, cssGradient, diverging, viridis, type ColorMap } from '../physics/colormaps';
import { isoSegments, niceLevels } from '../physics/contours';
import { quantileRange, sample, speed, vorticity } from '../physics/field';
import { defaultStreamlines, traceBoth, type Polyline } from '../physics/streamlines';

export type FieldView = 'speed' | 'pressure' | 'vorticity';
export interface Viewport { x0: number; x1: number; y0: number; y1: number }

/** Two framings with the same aspect ratio (1.875): around the airfoil, and the whole sampled window. */
export const VIEWPORTS: Record<'airfoil' | 'wake', Viewport> = {
  airfoil: { x0: -0.3, x1: 1.5, y0: -0.55, y1: 0.41 },
  wake: { x0: -0.6, x1: 2.4, y0: -0.9, y1: 0.7 },
};

export const VIEW_INFO: Record<FieldView, { label: string; unit: string; map: ColorMap; help: string }> = {
  speed: { label: 'Velocity magnitude', unit: '|u| / U∞', map: viridis, help: 'Speed relative to the free stream. Zero at the wall (no-slip) and at stagnation points.' },
  pressure: { label: 'Pressure coefficient', unit: 'Cp', map: diverging, help: 'Cp = (p − p∞)/(½ρU∞²). Blue: suction (Cp < 0), red: overpressure (Cp > 0).' },
  vorticity: { label: 'Vorticity', unit: 'ω c / U∞', map: diverging, help: 'ω = ∂v/∂x − ∂u/∂y. Red: counter-clockwise, blue: clockwise rotation. Born at the wall, carried into the wake.' },
};

const MARKERS: Record<string, { color: string; label: string }> = {
  stagnation: { color: palette.signal.amber, label: 'S' },
  separation: { color: palette.signal.rose, label: 'Sep' },
  reattachment: { color: palette.signal.teal, label: 'R' },
  saddle: { color: palette.signal.cyan, label: '' },
  vortex: { color: palette.signal.violet, label: '' },
};

interface Props {
  loaded: LoadedCase;
  stateIndex: number;
  view: FieldView;
  viewport: Viewport;
  outline: [number, number][];
  showStreamlines: boolean;
  showContours: boolean;
  /** Critical points belong to the steady / time-averaged state only. */
  wallPoints: WallPoint[] | null;
  fieldPoints: FieldPoint[] | null;
  seeds: [number, number][];
  onAddSeed: (x: number, y: number) => void;
}

function useWidth(ref: React.RefObject<HTMLElement>) {
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function FlowCanvas({ loaded, stateIndex, view, viewport: vp, outline, showStreamlines, showContours, wallPoints, fieldPoints, seeds, onAddSeed }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useWidth(wrap);
  const height = Math.round((width * (vp.y1 - vp.y0)) / (vp.x1 - vp.x0));
  const [hover, setHover] = useState<{ px: number; py: number; x: number; y: number } | null>(null);

  const { grid } = loaded;
  const state = loaded.fields[Math.min(stateIndex, loaded.fields.length - 1)];
  const info = VIEW_INFO[view];

  const scalar = useMemo(
    () => (view === 'speed' ? speed(state.u, state.v) : view === 'pressure' ? state.cp : vorticity(grid, state.u, state.v)),
    [view, state, grid],
  );
  const range = useMemo<[number, number]>(() => {
    if (view === 'speed') return [0, Math.max(1.2, quantileRange(scalar, 0, 0.998)[1])];
    const [lo, hi] = quantileRange(scalar, view === 'pressure' ? 0.001 : 0.02, view === 'pressure' ? 0.999 : 0.98);
    const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-6);
    return [-m, m];
  }, [scalar, view]);

  const image = useMemo(() => {
    const img = new ImageData(grid.nx, grid.ny);
    const [lo, hi] = range;
    for (let k = 0; k < scalar.length; k++) {
      const v = scalar[k];
      if (!Number.isFinite(v)) continue;
      const [r, g, b] = colorAt(info.map, (v - lo) / (hi - lo));
      img.data[4 * k] = r; img.data[4 * k + 1] = g; img.data[4 * k + 2] = b; img.data[4 * k + 3] = 255;
    }
    // Grid nodes inside the airfoil have no value. Extend the neighbouring colours two nodes inward so
    // the pixel staircase stays hidden under the exact outline drawn on top.
    for (let pass = 0; pass < 2; pass++) {
      const src = img.data.slice();
      for (let j = 0; j < grid.ny; j++) {
        for (let i = 0; i < grid.nx; i++) {
          const k = j * grid.nx + i;
          if (src[4 * k + 3]) continue;
          const n = [i > 0 ? k - 1 : -1, i < grid.nx - 1 ? k + 1 : -1, j > 0 ? k - grid.nx : -1, j < grid.ny - 1 ? k + grid.nx : -1].find((q) => q >= 0 && src[4 * q + 3]);
          if (n === undefined) continue;
          for (let c = 0; c < 4; c++) img.data[4 * k + c] = src[4 * n + c];
        }
      }
    }
    const off = document.createElement('canvas');
    off.width = grid.nx; off.height = grid.ny;
    off.getContext('2d')!.putImageData(img, 0, 0);
    return off;
  }, [scalar, range, grid, info.map]);

  const band = useMemo<[number, number]>(() => [Math.min(...outline.map((p) => p[1])), Math.max(...outline.map((p) => p[1]))], [outline]);
  const lines = useMemo<Polyline[]>(() => (showStreamlines ? defaultStreamlines(grid, state.u, state.v, band) : []), [showStreamlines, grid, state, band]);
  const userLines = useMemo(() => seeds.map(([x, y]) => traceBoth(grid, state.u, state.v, x, y, { maxLength: 5 })), [seeds, grid, state]);
  const contours = useMemo(() => {
    if (!showContours) return [];
    const levels = niceLevels(range[0], range[1], view === 'speed' ? 10 : 14).filter((l) => view === 'speed' || Math.abs(l) > 1e-9);
    return levels.map((l) => ({ level: l, segs: isoSegments(grid, scalar, l) }));
  }, [showContours, range, view, grid, scalar]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext('2d')!;
    const a = width / (vp.x1 - vp.x0);
    const b = height / (vp.y1 - vp.y0);
    const sx = (x: number) => (x - vp.x0) * a;
    const sy = (y: number) => height - (y - vp.y0) * b;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = palette.space[950];
    ctx.fillRect(0, 0, width, height);

    // Field image: pixel (i, j) is grid node (x0 + i h, y0 + j h); row 0 is the bottom of the window
    const h = grid.spacing;
    const xl = grid.x0 - h / 2, yb = grid.y0 - h / 2;
    ctx.save();
    ctx.setTransform(dpr * a * h, 0, 0, -dpr * b * h, dpr * sx(xl), dpr * sy(yb));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, 0, 0);
    ctx.restore();

    ctx.lineWidth = 0.7;
    for (const { level, segs } of contours) {
      ctx.strokeStyle = view === 'speed' ? 'rgba(10,18,38,0.45)' : level < 0 ? 'rgba(198,236,255,0.5)' : 'rgba(255,217,160,0.5)';
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(sx(x1), sy(y1)); ctx.lineTo(sx(x2), sy(y2)); }
      ctx.stroke();
    }

    const drawLine = (line: Polyline, color: string, w: number) => {
      if (line.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      line.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
      ctx.stroke();
      // direction arrows every ~0.4 c of arc length
      let s = 0;
      for (let i = 1; i < line.length; i++) {
        const dx = line[i][0] - line[i - 1][0], dy = line[i][1] - line[i - 1][1];
        s += Math.hypot(dx, dy);
        if (s < 0.4) continue;
        s = 0;
        const ang = Math.atan2(-dy * b, dx * a);
        const X = sx(line[i][0]), Y = sy(line[i][1]);
        ctx.beginPath();
        ctx.moveTo(X - 5 * Math.cos(ang - 0.45), Y - 5 * Math.sin(ang - 0.45));
        ctx.lineTo(X, Y);
        ctx.lineTo(X - 5 * Math.cos(ang + 0.45), Y - 5 * Math.sin(ang + 0.45));
        ctx.stroke();
      }
    };
    const streamColor = view === 'speed' ? 'rgba(255,255,255,0.55)' : 'rgba(226,232,240,0.6)';
    lines.forEach((l) => drawLine(l, streamColor, 0.9));
    userLines.forEach((l) => drawLine(l, palette.signal.lime, 1.6));

    ctx.beginPath();
    outline.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.closePath();
    ctx.fillStyle = palette.space[800];
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const label = (X: number, Y: number, text: string, color: string) => {
      if (!text) return;
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(5,9,20,0.75)';
      const w = ctx.measureText(text).width + 6;
      ctx.fillRect(X + 7, Y - 17, w, 14);
      ctx.fillStyle = color;
      ctx.fillText(text, X + 10, Y - 6);
    };
    for (const p of wallPoints ?? []) {
      const m = MARKERS[p.kind];
      if (!m) continue;
      const X = sx(p.x), Y = sy(p.y);
      ctx.fillStyle = m.color;
      ctx.strokeStyle = palette.space[950];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (p.kind === 'stagnation') { ctx.moveTo(X, Y - 6); ctx.lineTo(X + 6, Y); ctx.lineTo(X, Y + 6); ctx.lineTo(X - 6, Y); ctx.closePath(); }
      else ctx.arc(X, Y, 4.5, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
      label(X, Y, m.label, m.color);
    }
    for (const p of fieldPoints ?? []) {
      const m = MARKERS[p.kind];
      if (!m) continue;
      const X = sx(p.x), Y = sy(p.y);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (p.kind === 'saddle') { ctx.moveTo(X - 5, Y - 5); ctx.lineTo(X + 5, Y + 5); ctx.moveTo(X + 5, Y - 5); ctx.lineTo(X - 5, Y + 5); }
      else { ctx.arc(X, Y, 5, 0, 2 * Math.PI); ctx.moveTo(X + 1.5, Y); ctx.arc(X, Y, 1.5, 0, 2 * Math.PI); }
      ctx.stroke();
    }

    // Axes ticks in chord units
    ctx.fillStyle = 'rgba(203,213,225,0.75)';
    ctx.font = '10px Inter, system-ui, sans-serif';
    const step = vp.x1 - vp.x0 > 2 ? 0.5 : 0.25;
    for (let x = Math.ceil(vp.x0 / step) * step; x <= vp.x1; x += step) ctx.fillText(x.toFixed(2).replace(/\.?0+$/, '') || '0', sx(x) + 2, height - 4);
    for (let y = Math.ceil(vp.y0 / step) * step; y <= vp.y1; y += step) if (Math.abs(y - vp.y0) > 0.05) ctx.fillText((Math.abs(y) < 1e-9 ? 0 : y).toFixed(2).replace(/\.?0+$/, ''), 3, sy(y) - 2);
  }, [width, height, vp, image, grid, contours, lines, userLines, outline, wallPoints, fieldPoints, view]);

  const toWorld = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    return { px, py, x: vp.x0 + (px / r.width) * (vp.x1 - vp.x0), y: vp.y1 - (py / r.height) * (vp.y1 - vp.y0) };
  };
  const readout = hover && (() => {
    const u = sample(grid, state.u, hover.x, hover.y);
    if (!Number.isFinite(u)) return null;
    const v = sample(grid, state.v, hover.x, hover.y);
    return { u, v, s: Math.hypot(u, v), cp: sample(grid, state.cp, hover.x, hover.y), val: sample(grid, scalar, hover.x, hover.y) };
  })();

  return (
    <div>
      <div ref={wrap} className="relative overflow-hidden rounded-lg border border-white/10">
        <canvas
          ref={canvas}
          style={{ width, height, display: 'block', cursor: 'crosshair' }}
          role="img"
          aria-label={`${info.label} around the airfoil${showStreamlines ? ' with streamlines' : ''}`}
          onMouseMove={(e) => setHover(toWorld(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => { const w = toWorld(e); onAddSeed(w.x, w.y); }}
        />
        {hover && readout && (
          <div className="pointer-events-none absolute rounded-md border border-white/15 bg-space-950/90 px-2 py-1 font-mono text-[10px] leading-4 text-slate-200"
            style={{ left: Math.min(hover.px + 12, width - 150), top: Math.max(hover.py - 58, 4) }}>
            <div>x/c {hover.x.toFixed(3)}  y/c {hover.y.toFixed(3)}</div>
            <div>u {readout.u.toFixed(3)}  v {readout.v.toFixed(3)}  |u| {readout.s.toFixed(3)}</div>
            <div>Cp {readout.cp.toFixed(3)}{view === 'vorticity' ? `  ω ${readout.val.toFixed(2)}` : ''}</div>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-[11px] text-slate-400">{info.unit}</span>
        <span className="font-mono text-[10px] text-slate-400">{range[0].toFixed(2)}</span>
        <div className="h-2.5 min-w-[120px] flex-1 rounded-sm" style={{ background: cssGradient(info.map) }} aria-hidden="true" />
        <span className="font-mono text-[10px] text-slate-400">{range[1].toFixed(2)}</span>
      </div>
    </div>
  );
}
