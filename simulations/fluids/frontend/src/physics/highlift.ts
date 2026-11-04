/**
 * Geometry of conceptual high-lift device illustrations, built from a real section outline
 * (chord frame, TE -> upper -> LE -> lower -> TE). The shapes are schematic: gaps, overlaps and
 * motions are representative of each device type, not of a particular aircraft, and no flow is
 * computed around them.
 */
export type Pt = [number, number];
export type DeviceId = 'plain' | 'split' | 'single-slotted' | 'fowler' | 'double-slotted' | 'slat' | 'krueger';

export interface Element { points: Pt[]; role: 'main' | 'flap' | 'vane' | 'slat' | 'krueger' | 'split' }

/** Rotation about c; positive degrees turn clockwise (trailing edge down, or nose down for a slat). */
export const rotate = ([x, y]: Pt, [cx, cy]: Pt, deg: number): Pt => {
  const a = (-deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [cx + c * (x - cx) - s * (y - cy), cy + s * (x - cx) + c * (y - cy)];
};
const move = (p: Pt[], dx: number, dy: number): Pt[] => p.map(([x, y]) => [x + dx, y + dy]);
const turn = (p: Pt[], c: Pt, deg: number): Pt[] => p.map((q) => rotate(q, c, deg));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Upper and lower surfaces sampled from the outline, both ordered from LE to TE. */
export function surfaces(outline: { x: number[]; y: number[] }) {
  const le = outline.x.indexOf(Math.min(...outline.x));
  const upper: Pt[] = [], lower: Pt[] = [];
  for (let i = le; i >= 0; i--) upper.push([outline.x[i], outline.y[i]]);
  for (let i = le; i < outline.x.length; i++) lower.push([outline.x[i], outline.y[i]]);
  return { upper, lower };
}

export function yAt(curve: Pt[], x: number): number {
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1], [x1, y1] = curve[i];
    if ((x0 - x) * (x1 - x) <= 0 && x1 !== x0) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return curve[x < curve[0][0] ? 0 : curve.length - 1][1];
}

const span = (c: Pt[], a: number, b: number): Pt[] => [[a, yAt(c, a)], ...c.filter(([x]) => x > a && x < b), [b, yAt(c, b)]];

/** Section between x = a and x = b (cut straight across). */
function piece(upper: Pt[], lower: Pt[], a: number, b: number): Pt[] {
  return [...span(upper, a, b), ...span(lower, a, b).reverse()];
}

/** Main element ending in a shroud (upper surface to xUpper) above a curved cove back to the lower surface at xLower. */
function mainWithCove(upper: Pt[], lower: Pt[], xUpper: number, xLower: number, x0 = upper[0][0]): Pt[] {
  const top = span(upper, x0, xUpper);
  const bottom = span(lower, x0, xLower).reverse();
  const [ux, uy] = top[top.length - 1], [lx, ly] = bottom[0];
  const cove: Pt[] = Array.from({ length: 8 }, (_, k) => {
    const t = (k + 1) / 9;
    return [lerp(ux, lx, t) - 0.03 * Math.sin(Math.PI * t), lerp(uy - 0.004, ly, t) + 0.01 * Math.sin(Math.PI * t)];
  });
  return [...top, ...cove, ...bottom];
}

/** Flap element: the aft part of the section from xc, with a rounded nose so it reads as an airfoil. */
function flapElement(upper: Pt[], lower: Pt[], xc: number, xe = 1.0): Pt[] {
  const yu = yAt(upper, xc + 0.02), yl = yAt(lower, xc + 0.02);
  const nose: Pt[] = Array.from({ length: 7 }, (_, k) => {
    const a = Math.PI / 2 + (Math.PI * k) / 6;
    return [xc + 0.02 + 0.02 * Math.cos(a), 0.5 * (yu + yl) + 0.5 * (yu - yl) * Math.sin(a)];
  });
  return [...nose.slice(0, 4).reverse(), ...span(upper, xc + 0.02, xe), ...span(lower, xc + 0.02, xe).reverse(), ...nose.slice(4).reverse()];
}

/**
 * Elements of a device at deployment d in [0, 1] (0 = retracted, 1 = fully deployed).
 * Flap chords 25-30% c, slat chord about 15% c; deflections are typical landing settings.
 */
export function deviceGeometry(id: DeviceId, outline: { x: number[]; y: number[] }, d: number): Element[] {
  const { upper, lower } = surfaces(outline);
  const whole = piece(upper, lower, upper[0][0], 1.0);
  switch (id) {
    case 'plain': {
      const xh = 0.75, hinge: Pt = [xh, 0.5 * (yAt(upper, xh) + yAt(lower, xh))];
      return [{ role: 'main', points: piece(upper, lower, upper[0][0], xh) }, { role: 'flap', points: turn(piece(upper, lower, xh, 1.0), hinge, 35 * d) }];
    }
    case 'split': {
      const xh = 0.75, hinge: Pt = [xh, yAt(lower, xh)];
      const plate: Pt[] = [hinge, [1.0, yAt(lower, 1.0)], [1.0, yAt(lower, 1.0) + 0.01], [xh, hinge[1] + 0.01]];
      return [{ role: 'main', points: whole }, { role: 'split', points: turn(plate, hinge, 55 * d) }];
    }
    case 'single-slotted': {
      const flap = flapElement(upper, lower, 0.72);
      const pivot: Pt = [0.76, -0.1];                   // hinge below the section: the flap swings down and away, opening a slot
      return [{ role: 'main', points: mainWithCove(upper, lower, 0.86, 0.72) }, { role: 'flap', points: turn(flap, pivot, 32 * d) }];
    }
    case 'fowler': {
      const flap = flapElement(upper, lower, 0.68);
      const travel = 0.24 * d;                          // rearward travel on tracks extends the chord
      const moved = move(flap, travel, -0.035 * d);
      return [{ role: 'main', points: mainWithCove(upper, lower, 0.9, 0.68) }, { role: 'flap', points: turn(moved, [0.7 + travel, -0.035 * d], 30 * d) }];
    }
    case 'double-slotted': {
      // vane: a small cambered element (the aft section shape shrunk chordwise), main flap behind it
      const vane = flapElement(upper, lower, 0.7).map(([x, y]) => [0.7 + 0.45 * (x - 0.7), y] as Pt);
      const flap = flapElement(upper, lower, 0.78);
      const v = turn(move(vane, 0.15 * d, -0.03 * d), [0.72 + 0.15 * d, -0.03 * d], 22 * d);
      const f = turn(move(flap, 0.15 * d, -0.075 * d), [0.8 + 0.15 * d, -0.075 * d], 42 * d);
      return [{ role: 'main', points: mainWithCove(upper, lower, 0.9, 0.68) }, { role: 'vane', points: v }, { role: 'flap', points: f }];
    }
    case 'slat': {
      // Slat: the nose of the section with a concave rear face; the main element gets a matching cove
      const xs = 0.16;
      const front = span(upper, upper[0][0], xs);
      const inner: Pt[] = Array.from({ length: 9 }, (_, k) => {
        const t = 1 - k / 8;
        const x = lerp(0.015, xs, t);
        return [x, yAt(upper, x) - 0.35 * (yAt(upper, x) - yAt(lower, x)) - 0.006 * Math.sin(Math.PI * t)];
      });
      const slatLower = span(lower, upper[0][0], 0.015).reverse();
      const slat: Pt[] = [...front, ...inner, ...slatLower];
      const main: Pt[] = [...inner.slice().reverse(), ...span(upper, xs, 1.0), ...span(lower, 0.015, 1.0).reverse()];
      // forward and down, nose down (counter clockwise about its leading edge): a slot opens above the main nose
      return [{ role: 'main', points: main }, { role: 'slat', points: turn(move(slat, -0.06 * d, -0.035 * d), [-0.06 * d, -0.035 * d], -15 * d) }];
    }
    case 'krueger': {
      // A panel stowed in the lower surface, hinged at its forward end, swings down and forward through
      // about 150 degrees; its free edge becomes a new, blunter leading edge ahead of and below the nose
      const hinge: Pt = [0.03, yAt(lower, 0.03)];
      const len = 0.15;
      const stowed = (k: number, offset: number): Pt => {
        const x = hinge[0] + (len * k) / 8;
        return [x, yAt(lower, x) + offset];
      };
      const plate: Pt[] = [];
      for (let k = 0; k <= 8; k++) plate.push(rotate(stowed(k, 0), hinge, 150 * d));
      for (let k = 8; k >= 0; k--) plate.push(rotate(stowed(k, 0.009), hinge, 150 * d));
      return [{ role: 'main', points: whole }, { role: 'krueger', points: plate }];
    }
  }
}

/** Overall chord of the configuration relative to the clean chord (Fowler action): c'/c. */
export function extendedChord(elements: Element[]): number {
  const xs = elements.flatMap((e) => e.points.map((p) => p[0]));
  return Math.max(...xs) - Math.min(...xs);
}
