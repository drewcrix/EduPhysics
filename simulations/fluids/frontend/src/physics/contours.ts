import type { FieldGrid } from '../data/types';

export type Segment = [number, number, number, number];

/**
 * Marching squares: line segments of the iso-line value = level, in physical coordinates.
 * Cells touching the body (NaN) are skipped; saddle cells use the cell-centre average to choose
 * the connection, the usual disambiguation.
 */
export function isoSegments(g: FieldGrid, values: Float32Array, level: number): Segment[] {
  const { nx, ny, x0, y0, spacing: h } = g;
  const out: Segment[] = [];
  const lerp = (a: number, b: number) => (level - a) / (b - a);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const a = values[k], b = values[k + 1], c = values[k + nx + 1], d = values[k + nx];
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
      const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const x = x0 + i * h, y = y0 + j * h;
      const bottom: [number, number] = [x + lerp(a, b) * h, y];
      const right: [number, number] = [x + h, y + lerp(b, c) * h];
      const top: [number, number] = [x + lerp(d, c) * h, y + h];
      const left: [number, number] = [x, y + lerp(a, d) * h];
      const add = (p: [number, number], q: [number, number]) => out.push([p[0], p[1], q[0], q[1]]);
      switch (code) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(right, top); break;
        case 6: case 9: add(bottom, top); break;
        case 7: case 8: add(left, top); break;
        case 5: case 10: {
          const centreAbove = (a + b + c + d) / 4 > level;
          if ((code === 5) === centreAbove) { add(left, top); add(bottom, right); } else { add(left, bottom); add(right, top); }
          break;
        }
      }
    }
  }
  return out;
}

/** "Nice" evenly spaced levels covering [lo, hi]. */
export function niceLevels(lo: number, hi: number, target = 12): number[] {
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const levels: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) levels.push(Number(v.toPrecision(12)));
  return levels;
}
