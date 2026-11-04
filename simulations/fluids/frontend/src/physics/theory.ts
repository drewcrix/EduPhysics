/**
 * Analytical results (thin-airfoil theory, Blasius). Mirrors eduphysics_fluids.theory; these are
 * never presented as Navier-Stokes results.
 */
const rad = (deg: number) => (deg * Math.PI) / 180;

export function thinAirfoilCl(aoaDeg: number, alphaL0Deg: number): number {
  return 2 * Math.PI * rad(aoaDeg - alphaL0Deg);
}

export interface FlapEstimate {
  effectiveness: number;
  deltaCl: number;
  deltaAlphaL0Deg: number;
  deltaCm: number;
}

/** Plain trailing-edge flap of chord E c deflected by delta (down positive) on a thin section. */
export function plainFlap(flapChordRatio: number, deflectionDeg: number): FlapEstimate {
  const E = Math.min(1, Math.max(0, flapChordRatio));
  const thetaH = Math.acos(2 * E - 1);
  const delta = rad(deflectionDeg);
  const tau = 1 - (thetaH - Math.sin(thetaH)) / Math.PI;
  return {
    effectiveness: tau,
    deltaCl: 2 * Math.PI * tau * delta,
    deltaAlphaL0Deg: (-tau * delta * 180) / Math.PI,
    deltaCm: -0.5 * delta * Math.sin(thetaH) * (1 - Math.cos(thetaH)),
  };
}

/** Laminar flat plate wetted on both sides. */
export const blasiusFrictionDrag = (re: number) => (2 * 1.328) / Math.sqrt(re);
/** Blasius 99% boundary-layer thickness delta / c at station x / c. */
export const boundaryLayerThickness = (re: number, x = 1) => (5 * x) / Math.sqrt(re * x);

export interface LiftPoint {
  aoa: number;
  cl: number;
  clMin?: number;
  clMax?: number;
}

export type StallAssessment =
  | { kind: 'maximum'; aoa: number; cl: number; next: number }
  | { kind: 'rising'; aoa: number; cl: number }
  | { kind: 'insufficient' };

/**
 * Only reports a lift maximum ("stall") when the data support it: the largest mean C_L must lie
 * inside the computed range and the next angle must be lower by more than both 0.02 and the
 * unsteady fluctuation of either point. Otherwise it says the curve is still rising (or flat).
 */
export function assessStall(points: LiftPoint[]): StallAssessment {
  const p = [...points].sort((a, b) => a.aoa - b.aoa);
  if (p.length < 3) return { kind: 'insufficient' };
  let k = 0;
  p.forEach((q, i) => { if (q.cl > p[k].cl) k = i; });
  const halfRange = (q: LiftPoint) => (q.clMax !== undefined && q.clMin !== undefined ? 0.5 * (q.clMax - q.clMin) : 0);
  if (k < p.length - 1) {
    const drop = p[k].cl - p[k + 1].cl;
    if (drop > Math.max(0.02, halfRange(p[k]), halfRange(p[k + 1]))) return { kind: 'maximum', aoa: p[k].aoa, cl: p[k].cl, next: p[k + 1].aoa };
  }
  return { kind: 'rising', aoa: p[k].aoa, cl: p[k].cl };
}

/** Least-squares lift slope (per radian) through the points with aoa in [lo, hi]. */
export function liftSlope(points: LiftPoint[], lo: number, hi: number): number | null {
  const q = points.filter((p) => p.aoa >= lo && p.aoa <= hi);
  if (q.length < 2) return null;
  const n = q.length;
  const mx = q.reduce((s, p) => s + rad(p.aoa), 0) / n;
  const my = q.reduce((s, p) => s + p.cl, 0) / n;
  const sxx = q.reduce((s, p) => s + (rad(p.aoa) - mx) ** 2, 0);
  const sxy = q.reduce((s, p) => s + (rad(p.aoa) - mx) * (p.cl - my), 0);
  return sxx > 0 ? sxy / sxx : null;
}
