import { describe, expect, it } from 'vitest';
import { assessStall, blasiusFrictionDrag, boundaryLayerThickness, liftSlope, plainFlap, thinAirfoilCl } from '../src/physics/theory';

describe('thin-airfoil theory (must match eduphysics_fluids.theory)', () => {
  it('lift line', () => {
    expect(thinAirfoilCl(5, 0)).toBeCloseTo(2 * Math.PI * (5 * Math.PI) / 180);
    expect(thinAirfoilCl(-2.077, -2.077)).toBe(0);
  });

  it('plain flap: same numbers as the Python implementation', () => {
    const f = plainFlap(0.25, 10);                     // python: theory.plain_flap(0.25, 10)
    expect(f.effectiveness).toBeCloseTo(0.6089977810442293, 12);
    expect(f.deltaCl).toBeCloseTo(0.6678407977830866, 12);
    expect(f.deltaAlphaL0Deg).toBeCloseTo(-6.089977810442293, 10);
    expect(f.deltaCm).toBeCloseTo(-0.11336246026463861, 12);
    expect(plainFlap(1, 10).effectiveness).toBeCloseTo(1);
  });

  it('flat-plate estimates', () => {
    expect(blasiusFrictionDrag(10000)).toBeCloseTo(0.02656);
    expect(boundaryLayerThickness(2500)).toBeCloseTo(0.1);
  });
});

describe('stall is only claimed when the data show a maximum', () => {
  const linear = [0, 4, 8, 12].map((a) => ({ aoa: a, cl: 0.08 * a }));
  it('rising curve: no stall', () => {
    expect(assessStall(linear)).toEqual({ kind: 'rising', aoa: 12, cl: expect.closeTo(0.96, 6) });
  });
  it('interior maximum with a clear drop: stall', () => {
    expect(assessStall([...linear, { aoa: 16, cl: 0.8 }])).toMatchObject({ kind: 'maximum', aoa: 12, next: 16 });
  });
  it('a drop smaller than the unsteady fluctuation is not a stall', () => {
    const pts = [...linear.slice(0, 3), { aoa: 12, cl: 0.96, clMin: 0.8, clMax: 1.12 }, { aoa: 16, cl: 0.9, clMin: 0.7, clMax: 1.1 }];
    expect(assessStall(pts).kind).toBe('rising');
  });
  it('too few points', () => {
    expect(assessStall(linear.slice(0, 2)).kind).toBe('insufficient');
  });
  it('lift slope from a least-squares fit', () => {
    expect(liftSlope(linear, -1, 5)).toBeCloseTo((0.08 * 180) / Math.PI, 8);
    expect(liftSlope(linear, 20, 30)).toBeNull();
  });
});
