import { describe, expect, it } from 'vitest';
import type { AirfoilInfo, CaseRecord, CaseSummary, Manifest } from '../src/data/types';
import { anglesFor, neighbours, resolve, reynoldsFor } from '../src/data/selection';
import { explain } from '../src/content/explain';
import { airfoilText } from '../src/content/airfoils';
import { devices } from '../src/content/highlift';
import { variantText } from '../src/content/boundaries';
import { deviceGeometry, extendedChord, surfaces, type DeviceId } from '../src/physics/highlift';
import { parseHash, hrefFor } from '../src/hooks/useRoute';
import { richParts } from '../src/components/Rich';

describe('subscript notation in plain-text content', () => {
  it('turns C_L, C_m,c/4, α_L0 and ΔC_l,max into base + subscript', () => {
    expect(richParts('C_L = 0.4 and C_m,c/4 < 0')).toEqual([{ base: 'C', sub: 'L' }, ' = 0.4 and ', { base: 'C', sub: 'm,c/4' }, ' < 0']);
    expect(richParts('2π(α − α_L0)')).toEqual(['2π(α − ', { base: 'α', sub: 'L0' }, ')']);
    expect(richParts('ΔC_l,max ≈ 0.9')).toEqual(['Δ', { base: 'C', sub: 'l,max' }, ' ≈ 0.9']);
    expect(richParts('no subscripts here')).toEqual(['no subscripts here']);
  });
});

const summary = (airfoil: string, reynolds: number, aoa: number, extra: Partial<CaseSummary> = {}): CaseSummary => ({
  id: `naca${airfoil}_re${reynolds}_a${aoa}`, airfoil, reynolds, aoa_deg: aoa, variant: 'baseline', class: 'steady',
  cl: 0.1 * aoa, cd: 0.1, cm: 0, cd_pressure: 0.03, cd_friction: 0.07, strouhal: null, stagnation_x: 0, stagnation_upper: false, separation_x: null, ...extra,
});

const naca0012Outline = (() => {
  const x: number[] = [], y: number[] = [];
  for (let k = 0; k <= 160; k++) {
    const th = (2 * Math.PI * k) / 160, xc = 0.5 * (1 + Math.cos(th));
    const t = 0.6 * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    x.push(xc); y.push(th <= Math.PI ? t : -t);
  }
  return { x, y };
})();

const airfoil: AirfoilInfo = {
  id: '0012', name: 'NACA 0012', family: '4-digit', thickness_ratio: 0.12, max_thickness_x: 0.3, max_camber: 0, max_camber_x: null,
  leading_edge_radius: 0.0159, theory: { alpha_l0_deg: 0, lift_slope_per_rad: 2 * Math.PI, cm_quarter_chord: 0 }, outline: naca0012Outline, camber_line: { x: [0, 1], y: [0, 0] },
};

const manifest = {
  airfoils: [airfoil, { ...airfoil, id: '2412', name: 'NACA 2412' }],
  cases: [summary('0012', 100, 0), summary('0012', 100, 4), summary('0012', 1000, 0), summary('0012', 1000, 4), summary('0012', 1000, 8),
    summary('2412', 500, -4), summary('2412', 500, 4), { ...summary('0012', 500, 6), variant: 'narrow_slip', id: 'x' }],
} as unknown as Manifest;

describe('case selection never leaves the computed set', () => {
  it('lists computed stops only', () => {
    expect(reynoldsFor(manifest, '0012')).toEqual([100, 1000]);
    expect(anglesFor(manifest, '0012', 1000)).toEqual([0, 4, 8]);
    expect(anglesFor(manifest, '2412', 500)).toEqual([-4, 4]);
  });
  it('snaps requests to the nearest existing case', () => {
    expect(resolve(manifest, { airfoil: '0012', reynolds: 300, aoa: 7 })).toMatchObject({ reynolds: 100, aoa: 4 });
    expect(resolve(manifest, { airfoil: '0012', reynolds: 2000, aoa: 7 })).toMatchObject({ reynolds: 1000, aoa: 8 });
    expect(resolve(manifest, { airfoil: 'nope', reynolds: NaN })?.airfoil).toBe('0012');
    expect(resolve(manifest, { airfoil: '2412', reynolds: 500, aoa: 0 })?.aoa).toBe(-4);
  });
  it('prefetches only existing neighbours', () => {
    const s = resolve(manifest, { airfoil: '0012', reynolds: 1000, aoa: 4 })!;
    expect(neighbours(manifest, s).sort()).toEqual(['naca0012_re1000_a0', 'naca0012_re1000_a8', 'naca0012_re100_a4']);
  });
});

function record(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    schema: 1, id: 'naca0012_re1000_a8', airfoil: '0012', reynolds: 1000, aoa_deg: 8, variant: 'baseline',
    flow: { class: 'steady', steady: true, t_end: 32, time: 21, residual: 1e-5, averaging_window: null, strouhal: null, peak_energy_share: null },
    coefficients: { cl: 0.4, cd: 0.15, cm: 0.01, cl_pressure: 0.41, cl_friction: -0.01, cd_pressure: 0.06, cd_friction: 0.09 },
    theory: { alpha_l0_deg: 0, lift_slope_per_rad: 2 * Math.PI, cm_quarter_chord: 0, cl_thin_airfoil: 0.877 },
    surface: { states: ['instantaneous'], station: [0, 0.5, 1], upper: [1, 1, 0], x: [0, 0.5, 1], y: [0, 0, 0], cp: [[1.08, -0.5, 0.1]], cf: [[0, 0.02, 0.01]] },
    wall_points: [{ kind: 'stagnation', x: 0.01, y: -0.01, station: 0.012, upper: false }, { kind: 'separation', x: 0.6, y: 0.04, station: 0.62, upper: true }],
    field: {} as CaseRecord['field'], field_points: [], history: { t: [], cl: [], cd: [] }, solver: {} as CaseRecord['solver'],
    ...overrides,
  };
}

describe('explanations follow the computed data', () => {
  it('describes separation, stagnation and lift deficit from the results', () => {
    const text = Object.fromEntries(explain(record(), airfoil, manifest.cases).map((i) => [i.id, i.text]));
    expect(text.separation).toMatch(/upper surface at x\/c = 0\.62.*stays separated/);
    expect(text.stagnation).toMatch(/lower surface at x\/c = 0\.012/);
    expect(text.stagnation).toMatch(/At α = 0° it was at x\/c = 0\.000/);
    expect(text.stagnation).toMatch(/above the inviscid stagnation value/);
    expect(text.lift).toMatch(/predicts 0\.877.*46% of the theoretical value/);
    expect(text.drag).toMatch(/60% skin friction/);
  });
  it('reports attached flow and unsteady averaging honestly', () => {
    const r = record({ wall_points: [{ kind: 'stagnation', x: 0, y: 0, station: 0, upper: false }],
      flow: { class: 'periodic', steady: false, t_end: 32, time: 32, residual: 1, averaging_window: [20, 32], strouhal: 0.5, peak_energy_share: 0.9 } });
    const text = Object.fromEntries(explain(r, airfoil, []).map((i) => [i.id, i.text]));
    expect(text.separation).toMatch(/No separation/);
    expect(text.regime).toMatch(/St = f c\/U∞ = 0\.500.*every 2\.0 convective times/);
    expect(text.lift).toMatch(/time average/);
  });
});

describe('static content', () => {
  it('covers every airfoil, device and boundary variant', () => {
    expect(Object.keys(airfoilText).sort()).toEqual(['0012', '2213', '23012', '2412']);
    expect(devices.map((d) => d.id).sort()).toEqual(['double-slotted', 'fowler', 'krueger', 'plain', 'single-slotted', 'slat', 'split']);
    expect(Object.keys(variantText).sort()).toEqual(['baseline', 'narrow_open', 'narrow_slip', 'short_inlet', 'short_outlet', 'short_outlet_zero_gradient']);
  });
  it('device drawings: retracted shapes match the clean section, Fowler flaps extend the chord', () => {
    const { upper, lower } = surfaces(naca0012Outline);
    expect(upper[0][0]).toBe(0);
    expect(lower[lower.length - 1][0]).toBeCloseTo(1);
    for (const d of devices) {
      for (const deploy of [0, 0.5, 1]) {
        const els = deviceGeometry(d.id as DeviceId, naca0012Outline, deploy);
        expect(els.every((e) => e.points.length >= 4 && e.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)))).toBe(true);
      }
    }
    expect(extendedChord(deviceGeometry('plain', naca0012Outline, 0))).toBeCloseTo(1, 2);
    expect(extendedChord(deviceGeometry('fowler', naca0012Outline, 1))).toBeGreaterThan(1.15);
  });
});

describe('routing', () => {
  it('round-trips pages, sections and parameters', () => {
    expect(parseHash(hrefFor('simulator', { airfoil: '2412', re: 500 }))).toMatchObject({ page: 'simulator', section: undefined });
    expect(parseHash(hrefFor('simulator', { re: 500 })).params.get('re')).toBe('500');
    expect(parseHash('#/theory/kutta')).toMatchObject({ page: 'theory', section: 'kutta' });
    expect(parseHash('#/nowhere').page).toBe('simulator');
  });
});
