import type { FieldGrid } from '../data/types';

/** Bilinear interpolation at (x, y); NaN outside the grid or if any surrounding node is inside the body. */
export function sample(g: FieldGrid, values: ArrayLike<number>, x: number, y: number): number {
  const fx = (x - g.x0) / g.spacing;
  const fy = (y - g.y0) / g.spacing;
  if (!(fx >= 0 && fy >= 0 && fx <= g.nx - 1 && fy <= g.ny - 1)) return NaN;
  const i = Math.min(Math.floor(fx), g.nx - 2);
  const j = Math.min(Math.floor(fy), g.ny - 2);
  const s = fx - i;
  const t = fy - j;
  const k = j * g.nx + i;
  return (1 - t) * ((1 - s) * values[k] + s * values[k + 1]) + t * ((1 - s) * values[k + g.nx] + s * values[k + g.nx + 1]);
}

export function speed(u: Float32Array, v: Float32Array): Float32Array {
  const out = new Float32Array(u.length);
  for (let k = 0; k < u.length; k++) out[k] = Math.hypot(u[k], v[k]);
  return out;
}

/**
 * Vorticity omega = dv/dx - du/dy (in units of U_inf / c) by central differences on the uniform
 * grid, one-sided next to the body or the window edge. This is post-processing of the interpolated
 * field, so near the wall it underestimates the true wall vorticity.
 */
export function vorticity(g: FieldGrid, u: Float32Array, v: Float32Array): Float32Array {
  const { nx, ny, spacing: h } = g;
  const out = new Float32Array(nx * ny);
  const d = (a: Float32Array, k: number, stride: number, i: number, n: number) => {
    const back = i > 0 ? a[k - stride] : NaN;
    const front = i < n - 1 ? a[k + stride] : NaN;
    if (Number.isFinite(back) && Number.isFinite(front)) return (front - back) / (2 * h);
    if (Number.isFinite(front)) return (front - a[k]) / h;
    if (Number.isFinite(back)) return (a[k] - back) / h;
    return NaN;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      out[k] = Number.isFinite(u[k]) ? d(v, k, 1, i, nx) - d(u, k, nx, j, ny) : NaN;
    }
  }
  return out;
}

/** Robust colour range: the given quantiles of the finite values. */
export function quantileRange(values: Float32Array, lo = 0.01, hi = 0.99): [number, number] {
  const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return [0, 1];
  const at = (q: number) => finite[Math.min(finite.length - 1, Math.max(0, Math.round(q * (finite.length - 1))))];
  return [at(lo), at(hi)];
}
