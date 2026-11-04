import type { ReactNode } from 'react';

/** Subscript notation used in plain-text content: C_L, C_m,c/4, α_L0, ΔC_l,max. */
const SUBSCRIPT = /([A-Za-zΔα])_([A-Za-z0-9∞]+(?:,[A-Za-z0-9/]+)*)/g;

export function richParts(text: string): (string | { base: string; sub: string })[] {
  const parts: (string | { base: string; sub: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(SUBSCRIPT)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push({ base: m[1], sub: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Renders text with that notation as real subscripts. */
export function Rich({ text }: { text: string }) {
  return <>{richParts(text).map((p, i): ReactNode => (typeof p === 'string' ? p : <span key={i}>{p.base}<sub>{p.sub}</sub></span>))}</>;
}
