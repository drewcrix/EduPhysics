import { decodeFields, gunzip, isGzip } from './decode';
import type { CaseRecord, CaseSummary, LoadedCase, Manifest } from './types';

/** Relative to the page, so the app works under any base path (./fluids/ on the platform site). */
const DATA_URL = `${import.meta.env.BASE_URL}data/`;

let manifest: Promise<Manifest> | null = null;
const cases = new Map<string, Promise<LoadedCase>>();

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  return response;
}

export function loadManifest(): Promise<Manifest> {
  manifest ??= fetchOk(`${DATA_URL}manifest.json`).then((r) => r.json() as Promise<Manifest>);
  manifest.catch(() => (manifest = null));
  return manifest;
}

async function fetchCase(id: string): Promise<LoadedCase> {
  const record = (await (await fetchOk(`${DATA_URL}cases/${id}.json`)).json()) as CaseRecord;
  let bytes = new Uint8Array(await (await fetchOk(`${DATA_URL}cases/${record.field.file}`)).arrayBuffer());
  if (isGzip(bytes)) bytes = await gunzip(bytes);
  const { nx, ny, x0, y0, spacing } = record.field;
  return { record, grid: { nx, ny, x0, y0, spacing }, fields: decodeFields(bytes, record.field) };
}

/** Cached: switching back to a case (or one that was prefetched) is instant. */
export function loadCase(id: string): Promise<LoadedCase> {
  let p = cases.get(id);
  if (!p) {
    p = fetchCase(id);
    cases.set(id, p);
    p.catch(() => cases.delete(id));
  }
  return p;
}

export function prefetch(ids: string[]) {
  const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb) : setTimeout(cb, 200));
  idle(() => ids.forEach((id) => loadCase(id).catch(() => undefined)));
}

export function findCase(m: Manifest, airfoil: string, reynolds: number, aoa: number, variant = 'baseline'): CaseSummary | undefined {
  return m.cases.find((c) => c.airfoil === airfoil && c.reynolds === reynolds && c.aoa_deg === aoa && c.variant === variant);
}
