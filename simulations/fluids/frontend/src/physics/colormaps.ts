/** Colour maps as evenly spaced RGB stops with linear interpolation. */
export type ColorMap = { name: string; stops: [number, number, number][] };

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Perceptually uniform sequential map (matplotlib's viridis, 9 stops). */
export const viridis: ColorMap = {
  name: 'viridis',
  stops: ['#440154', '#472c7a', '#3b518b', '#2c718e', '#21908d', '#27ad81', '#5cc863', '#aadc32', '#fde725'].map(hex),
};

/** Diverging map with a dark centre (suits the dark interface): blue below the centre, red/orange above. */
export const diverging: ColorMap = {
  name: 'diverging',
  stops: ['#c6ecff', '#4cb7e6', '#2a6fb5', '#1c3a6e', '#121826', '#6e1f2e', '#b8333a', '#ec7a45', '#ffd9a0'].map(hex),
};

export function colorAt(map: ColorMap, t: number): [number, number, number] {
  const s = map.stops;
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (s.length - 1);
  const i = Math.min(Math.floor(x), s.length - 2);
  const f = x - i;
  return [0, 1, 2].map((c) => Math.round(s[i][c] + f * (s[i + 1][c] - s[i][c]))) as [number, number, number];
}

export function cssGradient(map: ColorMap): string {
  return `linear-gradient(to right, ${map.stops.map(([r, g, b], i) => `rgb(${r},${g},${b}) ${(100 * i) / (map.stops.length - 1)}%`).join(', ')})`;
}
