import type { DeviceId } from '../physics/highlift';

export interface Device {
  id: DeviceId;
  name: string;
  edge: 'trailing' | 'leading';
  summary: string;
  camber: string;
  chord: string;
  pressure: string;
  separation: string;
  maxLift: string;
  /** Approximate increment in section maximum lift for preliminary design (high Reynolds number). */
  typicalDeltaClmax: string;
}

/** Increments from Raymer, "Aircraft Design: A Conceptual Approach", table of approximate high-lift device
 * contributions (2D, high Re, for preliminary sizing). c'/c is the extended chord ratio. */
export const RAYMER_NOTE =
  "Typical ΔC_l,max values are the approximate figures used for preliminary design in D. P. Raymer, Aircraft Design: A Conceptual Approach (AIAA). They apply to high-Reynolds-number wings, not to the Re ≤ 2000 flows simulated here, and real values depend strongly on the detailed geometry.";

export const devices: Device[] = [
  {
    id: 'plain', name: 'Plain flap', edge: 'trailing',
    summary: 'The rear 20–30% of the section hinges downward.',
    camber: 'Increases camber sharply near the trailing edge, so the zero-lift angle becomes more negative and the whole lift curve moves up.',
    chord: 'No chord extension.',
    pressure: 'Raises the loading over the entire chord, not only on the flap, because the higher circulation changes the flow everywhere; the suction peak at the nose also grows. The nose-down pitching moment increases.',
    separation: 'Flow must turn sharply over the hinge, and the boundary layer on the flap\'s upper surface separates at moderate deflections, so effectiveness drops beyond roughly 15–20°. Drag rises steeply with deflection.',
    maxLift: 'C_L,max rises, but the stall angle usually falls slightly because the main section works harder at a given α.',
    typicalDeltaClmax: '≈ 0.9',
  },
  {
    id: 'split', name: 'Split flap', edge: 'trailing',
    summary: 'Only a plate forming the lower surface of the trailing edge hinges down; the upper surface does not move.',
    camber: 'Adds effective camber like a plain flap.',
    chord: 'No chord extension.',
    pressure: 'Creates high pressure ahead of the plate and a low-pressure, separated region behind it, which lowers the pressure at the trailing edge and lets the upper surface sustain more suction.',
    separation: 'The flow behind the plate is always separated, so drag is high: useful for landing, where drag is welcome.',
    maxLift: 'Lift gain similar to a plain flap with less tendency for the upper-surface flow to separate.',
    typicalDeltaClmax: '≈ 0.9',
  },
  {
    id: 'single-slotted', name: 'Single-slotted flap', edge: 'trailing',
    summary: 'The flap moves down and slightly back, opening a slot between the main section and the flap.',
    camber: 'Increases camber of the combined configuration.',
    chord: 'A small chord increase.',
    pressure: 'The flap sits in the high-velocity flow under the main element\'s trailing edge. That raises the main element\'s circulation and relieves its pressure recovery (the "circulation" and "dumping" effects).',
    separation: 'The flap starts a fresh, thin boundary layer that tolerates a much stronger adverse pressure gradient than the thick one arriving from the main element would, so the flow stays attached to larger deflections. The common explanation that the slot "blows high-energy air" into the boundary layer is incomplete; see A. M. O. Smith, "High-Lift Aerodynamics" (J. Aircraft, 1975).',
    maxLift: 'Clearly higher C_L,max than a plain flap at moderate extra drag.',
    typicalDeltaClmax: '≈ 1.5',
  },
  {
    id: 'fowler', name: 'Fowler flap', edge: 'trailing',
    summary: 'The flap runs aft on tracks before it deflects, emerging from under the main section with a slot.',
    camber: 'Adds camber like other trailing-edge flaps.',
    chord: 'Extends the chord, and so the wing area, by up to 20–30%. Coefficients referred to the clean chord rise by roughly the factor c\'/c in addition to the camber effect.',
    pressure: 'Combines the extra area with the slot effects of a slotted flap; small deflections (take-off) give mainly area, large deflections (landing) add camber and drag.',
    separation: 'Fresh boundary layer on the flap, as for slotted flaps.',
    maxLift: 'Large C_L,max increase with relatively low drag at take-off settings.',
    typicalDeltaClmax: "≈ 1.3 c'/c",
  },
  {
    id: 'double-slotted', name: 'Double-slotted Fowler flap', edge: 'trailing',
    summary: 'A vane and a main flap, each with its own slot, extend aft and deflect.',
    camber: 'Large total turning of the flow, split between two elements.',
    chord: 'Chord extension as for a Fowler flap.',
    pressure: 'Each element carries part of the load; each upstream element\'s trailing edge sits in high-velocity flow created by the element behind it, which relieves its pressure recovery.',
    separation: 'Two fresh boundary layers allow a total deflection that a single surface could not turn without separating.',
    maxLift: 'Among the highest trailing-edge-device lift increments, at the cost of mechanical complexity and weight.',
    typicalDeltaClmax: "≈ 1.6 c'/c",
  },
  {
    id: 'slat', name: 'Leading-edge slat', edge: 'leading',
    summary: 'A small aerofoil-shaped element at the nose moves forward and down, opening a slot.',
    camber: 'Adds camber at the front of the section (droops the nose) and slightly increases chord.',
    chord: 'Small chord extension.',
    pressure: 'The slat\'s own circulation reduces the velocity, and so the suction peak, near the main element\'s leading edge (the "slat effect"). The slat itself carries a strong suction peak, but its short chord means only a short pressure recovery.',
    separation: 'By flattening the main element\'s suction peak and its pressure recovery, the slat delays leading-edge separation, the stall mechanism at high α.',
    maxLift: 'Raises the stall angle substantially and so C_L,max, while barely changing lift at a given α below stall: the lift curve is extended upward rather than shifted.',
    typicalDeltaClmax: "≈ 0.4 c'/c",
  },
  {
    id: 'krueger', name: 'Krueger flap', edge: 'leading',
    summary: 'A panel stowed in the lower surface near the nose swings down and forward to form a new leading edge.',
    camber: 'Adds leading-edge camber and a larger, blunter nose.',
    chord: 'Small chord extension.',
    pressure: 'Like a slat, it reduces the suction peak on the original nose and spreads the pressure recovery.',
    separation: 'Delays leading-edge separation; typically used on thin sections or inboard wing parts where a slat is impractical.',
    maxLift: 'Increases the stall angle and C_L,max, usually less than a slat.',
    typicalDeltaClmax: '≈ 0.3',
  },
];
