import { describe, expect, it } from 'vitest';
import type { FieldGrid } from '../src/data/types';
import { quantileRange, sample, speed, vorticity } from '../src/physics/field';
import { trace, traceBoth } from '../src/physics/streamlines';
import { isoSegments, niceLevels } from '../src/physics/contours';
import { colorAt, viridis } from '../src/physics/colormaps';
import { outlineLab, toChord, toLab } from '../src/physics/geometry';

const grid: FieldGrid = { nx: 81, ny: 61, x0: -2, y0: -1.5, spacing: 0.05 };
const field = (f: (x: number, y: number) => number) => {
  const out = new Float32Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j++) for (let i = 0; i < grid.nx; i++) out[j * grid.nx + i] = f(grid.x0 + i * grid.spacing, grid.y0 + j * grid.spacing);
  return out;
};

describe('field sampling and derivatives', () => {
  it('bilinear interpolation is exact for linear fields and NaN outside', () => {
    const f = field((x, y) => 2 * x - 3 * y + 1);
    expect(sample(grid, f, 0.123, -0.456)).toBeCloseTo(2 * 0.123 + 3 * 0.456 + 1, 5);
    expect(Number.isNaN(sample(grid, f, 5, 0))).toBe(true);
  });

  it('solid-body rotation has uniform vorticity 2 Omega', () => {
    const omega = 0.7;
    const w = vorticity(grid, field((_x, y) => -omega * y), field((x) => omega * x));
    expect(w[30 * grid.nx + 40]).toBeCloseTo(2 * omega, 4);
    expect(w[0]).toBeCloseTo(2 * omega, 4);                    // one-sided at the window corner
  });

  it('vorticity is NaN inside the body and speed is |u|', () => {
    const u = field(() => 3), v = field(() => 4);
    u[100] = NaN;
    expect(Number.isNaN(vorticity(grid, u, v)[100])).toBe(true);
    expect(speed(u, v)[5]).toBeCloseTo(5);
    expect(quantileRange(field((x) => x), 0, 1)).toEqual([expect.closeTo(-2, 5), expect.closeTo(2, 5)]);
  });
});

describe('streamlines', () => {
  it('follow a uniform stream in a straight line', () => {
    const line = trace(grid, field(() => 1), field(() => 0.5), -1.8, 0, { maxLength: 1 });
    const [x, y] = line[line.length - 1];
    expect(y - 0).toBeCloseTo(0.5 * (x + 1.8), 6);
    expect(Math.hypot(x + 1.8, y)).toBeCloseTo(1, 1);
  });

  it('close on themselves around an eddy', () => {
    const line = trace(grid, field((_x, y) => -y), field((x) => x), 0.5, 0, { maxLength: 10 });
    const radii = line.map(([x, y]) => Math.hypot(x, y));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-3);
    expect(line[line.length - 1]).toEqual([0.5, 0]);
    expect(line.length).toBeLessThan(10 / (0.6 * grid.spacing));   // stopped after one turn
  });

  it('stop at the body and run both ways through a point', () => {
    const u = field(() => 1), v = field(() => 0);
    for (let j = 0; j < grid.ny; j++) u[j * grid.nx + 60] = NaN;  // a wall at x = 1
    const line = traceBoth(grid, u, v, 0, 0, { maxLength: 5 });
    expect(line[0][0]).toBeCloseTo(-2, 1);
    expect(line[line.length - 1][0]).toBeLessThan(1);
  });
});

describe('contours and colours', () => {
  it('iso-lines of x are vertical segments at the level', () => {
    const segs = isoSegments(grid, field((x) => x), 0.33);
    expect(segs.length).toBe(grid.ny - 1);
    segs.forEach(([x1, , x2]) => { expect(x1).toBeCloseTo(0.33, 5); expect(x2).toBeCloseTo(0.33, 5); });
    expect(niceLevels(-1.2, 0.9, 10)).toContain(0);
  });

  it('colour maps interpolate between stops and clamp', () => {
    expect(colorAt(viridis, 0)).toEqual([0x44, 0x01, 0x54]);
    expect(colorAt(viridis, 2)).toEqual([0xfd, 0xe7, 0x25]);
    expect(colorAt(viridis, NaN)).toEqual([0x44, 0x01, 0x54]);
  });
});

describe('airfoil frame', () => {
  it('pitches nose up about the leading edge, as the Python solver does', () => {
    const [x, y] = toLab(1, 0, 10);
    expect(x).toBeCloseTo(Math.cos(Math.PI / 18));
    expect(y).toBeCloseTo(-Math.sin(Math.PI / 18));
    const [xc, yc] = toChord(x, y, 10);
    expect(xc).toBeCloseTo(1); expect(yc).toBeCloseTo(0);
    expect(outlineLab({ x: [0, 1], y: [0, 0] }, 0)).toEqual([[0, 0], [1, 0]]);
  });
});
