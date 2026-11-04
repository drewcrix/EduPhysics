import type { FieldGrid } from '../data/types';
import { sample } from './field';

export type Polyline = [number, number][];

export interface TraceOptions {
  /** Arc-length step in chord units. */
  step?: number;
  maxLength?: number;
  /** +1 downstream along the flow, -1 upstream against it. */
  direction?: 1 | -1;
  /** Stop where the flow is (nearly) stagnant: |u| / U_inf below this. */
  minSpeed?: number;
}

/**
 * Streamline through (x0, y0): dx/ds = u/|u| integrated with classical RK4 in arc length s, using
 * bilinear velocity. Stops at the body, the window edge, a stagnation point, or when the curve
 * closes on itself (a recirculating eddy of a steady or time-averaged field).
 */
export function trace(g: FieldGrid, u: Float32Array, v: Float32Array, x0: number, y0: number, opts: TraceOptions = {}): Polyline {
  const h = opts.step ?? g.spacing * 0.6;
  const dir = opts.direction ?? 1;
  const maxSteps = Math.ceil((opts.maxLength ?? 8) / h);
  const minSpeed = opts.minSpeed ?? 1e-3;
  const f = (x: number, y: number): [number, number] | null => {
    const a = sample(g, u, x, y);
    const b = sample(g, v, x, y);
    const m = Math.hypot(a, b);
    if (!Number.isFinite(m) || m < minSpeed) return null;
    return [(dir * a) / m, (dir * b) / m];
  };
  const line: Polyline = [[x0, y0]];
  let x = x0;
  let y = y0;
  for (let n = 0; n < maxSteps; n++) {
    const k1 = f(x, y);
    if (!k1) break;
    const k2 = f(x + 0.5 * h * k1[0], y + 0.5 * h * k1[1]);
    if (!k2) break;
    const k3 = f(x + 0.5 * h * k2[0], y + 0.5 * h * k2[1]);
    if (!k3) break;
    const k4 = f(x + h * k3[0], y + h * k3[1]);
    if (!k4) break;
    x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    line.push([x, y]);
    if (n > 20 && Math.hypot(x - x0, y - y0) < 0.75 * h) {    // closed orbit around an eddy centre
      line.push([x0, y0]);
      break;
    }
  }
  return line;
}

/** Through a point in both directions (for user-placed streamlines). */
export function traceBoth(g: FieldGrid, u: Float32Array, v: Float32Array, x: number, y: number, opts: TraceOptions = {}): Polyline {
  const back = trace(g, u, v, x, y, { ...opts, direction: -1 });
  const front = trace(g, u, v, x, y, { ...opts, direction: 1 });
  return [...back.reverse(), ...front.slice(1)];
}

/**
 * Default picture: streamlines released from a line upstream, denser across the airfoil band, plus
 * lines through regions of reversed flow so separation bubbles and eddies are visible too.
 */
export function defaultStreamlines(g: FieldGrid, u: Float32Array, v: Float32Array, band: [number, number]): Polyline[] {
  const lines: Polyline[] = [];
  const x0 = g.x0 + 2 * g.spacing;
  const yTop = g.y0 + (g.ny - 3) * g.spacing;
  const seeds: number[] = [];
  for (let y = g.y0 + 2 * g.spacing; y <= yTop; y += 0.06) seeds.push(y);
  for (let y = band[0] - 0.1; y <= band[1] + 0.1; y += 0.02) seeds.push(y);
  for (const y of seeds.sort((a, b) => a - b)) lines.push(trace(g, u, v, x0, y, { maxLength: 6 }));

  // Reversed-flow regions: seed on a coarse lattice where u < 0, skipping points already covered
  const taken: [number, number][] = [];
  const stride = 6;
  for (let j = 0; j < g.ny; j += stride) {
    for (let i = 0; i < g.nx; i += stride) {
      const k = j * g.nx + i;
      if (!(u[k] < -0.02)) continue;
      const x = g.x0 + i * g.spacing;
      const y = g.y0 + j * g.spacing;
      if (taken.some(([a, b]) => Math.hypot(a - x, b - y) < 0.08)) continue;
      const line = traceBoth(g, u, v, x, y, { maxLength: 3 });
      if (line.length > 8) {
        lines.push(line);
        for (let q = 0; q < line.length; q += 4) taken.push(line[q]);
      }
    }
  }
  return lines;
}
