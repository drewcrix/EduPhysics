import type { AirfoilInfo, CaseRecord, CaseSummary } from '../data/types';
import { blasiusFrictionDrag, boundaryLayerThickness, thinAirfoilCl } from '../physics/theory';

export interface Insight {
  id: 'regime' | 'boundary-layer' | 'lift' | 'drag' | 'stagnation' | 'separation' | 'moment';
  title: string;
  text: string;
}

const f2 = (v: number) => v.toFixed(2);
const f3 = (v: number) => v.toFixed(3);
const pct = (v: number) => `${Math.round(100 * v)}%`;

/** Explanations generated from the computed results of one case (never from expectations). */
export function explain(record: CaseRecord, airfoil: AirfoilInfo, siblings: CaseSummary[]): Insight[] {
  const out: Insight[] = [];
  const { flow, coefficients: c, reynolds: re, aoa_deg: aoa } = record;
  const last = record.surface.states.length - 1;
  const averaged = !flow.steady;

  // Regime
  const regime: Record<string, string> = {
    steady: `The flow converged to a steady state (by t = ${flow.time.toFixed(1)} c/U∞ after an impulsive start).`,
    nearly_steady: 'The flow is effectively steady: the forces changed by less than 0.001 over the last 12 convective times, although the strict residual test was not met.',
    periodic: flow.strouhal
      ? `The flow is unsteady: vortices are shed periodically into the wake at a Strouhal number St = f c/U∞ = ${f3(flow.strouhal)}, i.e. one cycle every ${(1 / flow.strouhal).toFixed(1)} convective times. All coefficients shown are averages over the last 12 time units${c.cl_min !== undefined ? `; C_L oscillates between ${f3(c.cl_min)} and ${f3(c.cl_max!)}` : ''}.`
      : 'The flow is unsteady and periodic. All coefficients shown are time averages.',
    irregular: 'The flow is unsteady without a single dominant frequency. Coefficients are averages over the last 12 time units and carry more uncertainty than a steady result.',
    not_converged: 'This run was still drifting when it ended, so its numbers are not final values. Treat it as indicative only; a longer simulation would be needed.',
  };
  const regimeTitle: Record<string, string> = {
    steady: 'Steady flow', nearly_steady: 'Effectively steady flow', periodic: 'Unsteady flow: vortex shedding',
    irregular: 'Unsteady flow', not_converged: 'Not converged',
  };
  out.push({ id: 'regime', title: regimeTitle[flow.class], text: regime[flow.class] });

  // Boundary layer thickness estimate
  const delta = boundaryLayerThickness(re, 1);
  const thickness = airfoil.thickness_ratio;
  out.push({
    id: 'boundary-layer',
    title: 'Boundary layer',
    text: `At Re = ${re} the laminar flat-plate (Blasius) estimate gives a boundary layer about δ ≈ 5c/√Re = ${f2(delta)}c thick at the trailing edge, ${delta > thickness ? `${(delta / thickness).toFixed(1)} times` : `${pct(delta / thickness)} of`} the airfoil's maximum thickness. ${delta > 0.5 * thickness ? 'Viscous effects reach far into the flow, so there is no thin boundary layer around an inviscid outer flow as classical theory assumes.' : 'The viscous layer is thinner than the airfoil, but still far thicker than at flight Reynolds numbers (10⁶ and above).'}`,
  });

  // Lift versus thin-airfoil theory
  const theory = thinAirfoilCl(aoa, airfoil.theory.alpha_l0_deg);
  let lift = `C_L = ${f3(c.cl)}${averaged ? ' (time average)' : ''}. Thin-airfoil theory, 2π(α − α_L0) with α_L0 = ${f2(airfoil.theory.alpha_l0_deg)}°, predicts ${f3(theory)}.`;
  if (Math.abs(theory) > 0.05) {
    const ratio = c.cl / theory;
    lift += ` The simulation gives ${pct(ratio)} of the theoretical value.`;
    if (ratio < 0.95 && flow.steady) lift += ' Viscous layers this thick displace the outer flow and reduce the effective camber and angle of attack, and the smooth flow-off at the trailing edge (the Kutta condition) holds only approximately, so less circulation develops than the inviscid theory assumes.';
    if (!flow.steady) lift += ' Theory assumes attached, steady flow, which no longer holds here.';
  } else if (airfoil.max_camber === 0 && Math.abs(aoa) < 1e-9) {
    lift += ' A symmetric section at zero incidence produces no lift by symmetry.';
  }
  out.push({ id: 'lift', title: 'Lift', text: lift });

  // Drag decomposition
  const friction = c.cd_friction / c.cd;
  let drag = `C_D = ${f3(c.cd)}: ${pct(friction)} skin friction and ${pct(1 - friction)} pressure (form) drag.`;
  if (Math.abs(aoa) <= 4) drag += ` For comparison, a flat plate with laminar boundary layers on both sides has C_D,f ≈ 2.656/√Re = ${f3(blasiusFrictionDrag(re))}${re < 500 ? ' (an estimate that itself loses accuracy at such low Re)' : ''}.`;
  if (friction < 0.5) drag += ' Pressure drag dominates because the flow leaves a broad, low-pressure separated wake behind the airfoil.';
  out.push({ id: 'drag', title: 'Drag', text: drag });

  // Stagnation point and its movement with angle of attack
  const stag = record.wall_points.find((p) => p.kind === 'stagnation');
  if (stag) {
    const cpMax = Math.max(...record.surface.cp[last]);
    const zero = siblings.find((s) => s.airfoil === record.airfoil && s.reynolds === re && s.aoa_deg === 0 && s.variant === 'baseline');
    let text = `The front stagnation point, where the dividing streamline meets the surface and the wall shear stress changes sign, lies on the ${stag.upper ? 'upper' : 'lower'} surface at x/c = ${f3(stag.station)}.`;
    if (zero && zero.stagnation_x !== null && aoa !== 0) text += ` At α = 0° it was at x/c = ${f3(zero.stagnation_x)} on the ${zero.stagnation_upper ? 'upper' : 'lower'} surface: ${aoa > 0 ? 'raising the nose moves it aft along the lower surface, and the air above it has to turn around the leading edge to reach the upper surface' : 'at negative incidence it moves onto the upper surface'}.`;
    text += ` The highest surface pressure is C_p = ${f2(cpMax)}${cpMax > 1.02 ? ', above the inviscid stagnation value of 1, because viscous normal stresses add to the stagnation pressure at low Reynolds number' : ''}.`;
    out.push({ id: 'stagnation', title: 'Stagnation point', text });
  }

  // Separation from the wall shear stress
  const sep = record.wall_points.filter((p) => p.kind === 'separation').sort((a, b) => a.station - b.station);
  const reattach = record.wall_points.filter((p) => p.kind === 'reattachment');
  let separation: string;
  if (sep.length === 0) {
    separation = 'No separation: the skin friction stays positive on both surfaces downstream of the stagnation point, so the boundary layer remains attached up to the trailing edge.';
  } else {
    const parts = sep.map((p) => {
      const r = reattach.find((q) => q.upper === p.upper && q.station > p.station);
      return `on the ${p.upper ? 'upper' : 'lower'} surface at x/c = ${f2(p.station)}${r ? ` (reattaching at x/c = ${f2(r.station)}: a closed separation bubble)` : ', and stays separated to the trailing edge'}`;
    });
    separation = `The boundary layer separates ${parts.join('; ')}. There the adverse pressure gradient has slowed the near-wall fluid until it reverses, the skin friction C_f turns negative, and the outer flow no longer follows the surface.${averaged ? ' (Located in the time-averaged flow.)' : ''}`;
  }
  out.push({ id: 'separation', title: 'Separation', text: separation });

  out.push({
    id: 'moment',
    title: 'Pitching moment',
    text: `C_m,c/4 = ${f3(c.cm)} (positive nose up). Thin-airfoil theory gives ${f3(airfoil.theory.cm_quarter_chord)}, independent of α, because the quarter chord is the aerodynamic centre of a thin airfoil in attached inviscid flow.${airfoil.max_camber > 0 ? ' Camber produces the nose-down value.' : ''}`,
  });
  return out;
}
