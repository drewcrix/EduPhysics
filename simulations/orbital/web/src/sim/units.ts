// Presentation-only unit conversions. Everything inside the core is SI.
import type { ComponentLabel } from './types';

export const DEG = Math.PI / 180;
export const R_EARTH = 6371e3;
export const OMEGA_EARTH = 7.292115e-5;

export interface DisplayUnit {
  unit: string;
  scale: number; // display = SI × scale
}

/** Unit used to show a *state* value (positions in km). */
export function stateUnit(l: ComponentLabel): DisplayUnit {
  switch (l.quantity) {
    case 'position': return { unit: 'km', scale: 1e-3 };
    case 'angle': return { unit: '°', scale: 1 / DEG };
    case 'rate': return { unit: '°/s', scale: 1 / DEG };
    default: return { unit: l.unit, scale: 1 };
  }
}

/** Unit used to show an *error* or uncertainty (positions in m). */
export function errorUnit(l: ComponentLabel): DisplayUnit {
  switch (l.quantity) {
    case 'angle': return { unit: '°', scale: 1 / DEG };
    case 'rate': return { unit: '°/s', scale: 1 / DEG };
    default: return { unit: l.unit, scale: 1 };
  }
}

export function fmt(v: number | undefined | null, digits = 3): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(2);
  return v.toPrecision(digits).replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m));
}

export function fmtTime(t: number): string {
  const s = Math.max(0, Math.round(t));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function fmtDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return Math.abs(m) >= 1000 ? `${fmt(m / 1000)} km` : `${fmt(m)} m`;
}
