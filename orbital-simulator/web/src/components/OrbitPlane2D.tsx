// 2-D fallback view (no WebGL needed): the orbit projected on the ECI x–y plane, with the
// estimate's *2-D marginal* confidence ellipse (scaled by χ²₂, not χ²₃ or χ²₁).
import { useEffect, useRef } from 'react';
import type { HistoryColumns } from '../sim/layout';
import type { Meta } from '../sim/types';
import { R_EARTH } from '../sim/units';

export function OrbitPlane2D({ meta, history: h, version, truthVisible, k2 }: { meta: Meta; history: HistoryColumns; version: number; truthVisible: boolean; k2: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * devicePixelRatio;
    c.height = H * devicePixelRatio;
    const g = c.getContext('2d')!;
    g.scale(devicePixelRatio, devicePixelRatio);
    g.fillStyle = '#040812';
    g.fillRect(0, 0, W, H);
    const cw = meta.model === 'cw6';
    let extent = cw ? 1 : 1.3 * R_EARTH;
    for (let k = 0; k < h.t.length; k++) extent = Math.max(extent, 1.1 * Math.abs(h.xEst[0][k]), 1.1 * Math.abs(h.xEst[1][k]));
    const s = (0.45 * Math.min(W, H)) / extent;
    const X = (x: number) => W / 2 + x * s, Y = (y: number) => H / 2 - y * s;
    if (!cw) {
      g.beginPath();
      g.arc(W / 2, H / 2, R_EARTH * s, 0, 2 * Math.PI);
      g.fillStyle = '#0b2559';
      g.fill();
      g.strokeStyle = 'rgba(56,225,255,0.4)';
      g.stroke();
    }
    const trail = (xs: number[], ys: number[], color: string) => {
      g.beginPath();
      xs.forEach((x, i) => (i ? g.lineTo(X(x), Y(ys[i])) : g.moveTo(X(x), Y(ys[i]))));
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.stroke();
    };
    if (truthVisible) trail(h.xTrue[0], h.xTrue[1], '#2dd4bf');
    trail(h.xEst[0], h.xEst[1], 'rgba(251,191,36,0.7)');
    const k = h.t.length - 1;
    if (k >= 0) {
      // 2-D marginal covariance of (x, y): eigen-decomposition of [[xx, xy], [xy, yy]]
      const a = h.posCov[0][k], b = h.posCov[1][k], d = h.posCov[3][k];
      const tr = (a + d) / 2, det = Math.sqrt(((a - d) / 2) ** 2 + b * b);
      const l1 = tr + det, l2 = Math.max(tr - det, 0);
      const ang = 0.5 * Math.atan2(2 * b, a - d);
      const mag = Math.max(1, Math.pow(10, Math.floor(Math.log10((0.04 * Math.min(W, H)) / Math.max(1e-9, Math.sqrt(k2 * l1) * s)))));
      g.save();
      g.translate(X(h.xEst[0][k]), Y(h.xEst[1][k]));
      g.rotate(-ang);
      g.beginPath();
      g.ellipse(0, 0, Math.sqrt(k2 * l1) * s * mag, Math.sqrt(k2 * l2) * s * mag, 0, 0, 2 * Math.PI);
      g.fillStyle = 'rgba(251,191,36,0.2)';
      g.fill();
      g.strokeStyle = '#fbbf24';
      g.stroke();
      g.restore();
      g.fillStyle = '#fbbf24';
      g.beginPath();
      g.arc(X(h.xEst[0][k]), Y(h.xEst[1][k]), 3, 0, 2 * Math.PI);
      g.fill();
      g.fillStyle = '#94a3b8';
      g.font = '11px Inter, sans-serif';
      g.fillText(`2-D view (WebGL unavailable) · x–y plane · 2-D marginal ellipse${mag > 1 ? ` ×${mag}` : ''}`, 10, H - 10);
    }
  }, [meta, h, version, truthVisible, k2]);
  return <canvas ref={ref} className="h-full w-full" role="img" aria-label="Orbit projected on the equatorial plane with the estimate's 2-D confidence ellipse" />;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
