import type { CaseSummary, Manifest } from './types';

/**
 * Selections always resolve to a case that exists in the manifest. Sliders offer exactly the
 * computed Reynolds numbers and angles for the chosen airfoil; nothing is interpolated.
 */
const baseline = (m: Manifest, airfoil: string) => m.cases.filter((c) => c.airfoil === airfoil && c.variant === 'baseline');

export function airfoilsWithData(m: Manifest): string[] {
  return m.airfoils.map((a) => a.id).filter((id) => baseline(m, id).length > 0);
}

export function reynoldsFor(m: Manifest, airfoil: string): number[] {
  return [...new Set(baseline(m, airfoil).map((c) => c.reynolds))].sort((a, b) => a - b);
}

export function anglesFor(m: Manifest, airfoil: string, reynolds: number): number[] {
  return [...new Set(baseline(m, airfoil).filter((c) => c.reynolds === reynolds).map((c) => c.aoa_deg))].sort((a, b) => a - b);
}

export function nearest(values: number[], v: number, log = false): number {
  const key = (x: number) => (log ? Math.log(x) : x);
  return values.reduce((best, x) => (Math.abs(key(x) - key(v)) < Math.abs(key(best) - key(v)) ? x : best), values[0]);
}

export interface Selection {
  airfoil: string;
  reynolds: number;
  aoa: number;
  summary: CaseSummary;
}

export function resolve(m: Manifest, wanted: { airfoil?: string | null; reynolds?: number; aoa?: number }): Selection | null {
  const airfoils = airfoilsWithData(m);
  if (!airfoils.length) return null;
  const airfoil = wanted.airfoil && airfoils.includes(wanted.airfoil) ? wanted.airfoil : airfoils[0];
  const res = reynoldsFor(m, airfoil);
  const reynolds = nearest(res, Number.isFinite(wanted.reynolds) ? wanted.reynolds! : res[0], true);
  const angles = anglesFor(m, airfoil, reynolds);
  const aoa = nearest(angles, Number.isFinite(wanted.aoa) ? wanted.aoa! : angles[0]);
  const summary = baseline(m, airfoil).find((c) => c.reynolds === reynolds && c.aoa_deg === aoa)!;
  return { airfoil, reynolds, aoa, summary };
}

/** Neighbouring cases to prefetch so slider steps feel instant. */
export function neighbours(m: Manifest, s: Selection): string[] {
  const angles = anglesFor(m, s.airfoil, s.reynolds);
  const res = reynoldsFor(m, s.airfoil);
  const i = angles.indexOf(s.aoa), j = res.indexOf(s.reynolds);
  const ids: string[] = [];
  const add = (re: number, aoa: number) => {
    const c = baseline(m, s.airfoil).find((x) => x.reynolds === re && x.aoa_deg === aoa);
    if (c) ids.push(c.id);
  };
  if (i > 0) add(s.reynolds, angles[i - 1]);
  if (i < angles.length - 1) add(s.reynolds, angles[i + 1]);
  if (j > 0) add(res[j - 1], s.aoa);
  if (j < res.length - 1) add(res[j + 1], s.aoa);
  return ids;
}
