/**
 * Chord frame <-> lab frame, identical to eduphysics_fluids.geometry.Airfoil: the airfoil is pitched
 * nose up by alpha about its leading edge and the free stream is along +x.
 */
export function toLab(xc: number, yc: number, aoaDeg: number): [number, number] {
  const a = (aoaDeg * Math.PI) / 180;
  return [xc * Math.cos(a) + yc * Math.sin(a), yc * Math.cos(a) - xc * Math.sin(a)];
}

export function toChord(x: number, y: number, aoaDeg: number): [number, number] {
  const a = (aoaDeg * Math.PI) / 180;
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
}

export function outlineLab(outline: { x: number[]; y: number[] }, aoaDeg: number): [number, number][] {
  return outline.x.map((x, i) => toLab(x, outline.y[i], aoaDeg));
}
