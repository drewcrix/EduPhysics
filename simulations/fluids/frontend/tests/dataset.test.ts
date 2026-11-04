/**
 * Checks the committed dataset through the frontend's own decoder: every case listed in the
 * manifest exists, fields decode, the airfoil is the only masked region and the far field upstream
 * is the free stream. Skipped when no dataset has been generated.
 */
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeFields } from '../src/data/decode';
import type { CaseRecord, Manifest } from '../src/data/types';
import { sample } from '../src/physics/field';

const dataDir = new URL('../../data/', import.meta.url);
const hasData = existsSync(new URL('manifest.json', dataDir));

describe.skipIf(!hasData)('generated dataset', () => {
  const manifest = hasData ? (JSON.parse(readFileSync(new URL('manifest.json', dataDir), 'utf8')) as Manifest) : null;

  it('lists only cases whose files exist', () => {
    expect(manifest!.cases.length).toBeGreaterThan(0);
    for (const c of manifest!.cases) {
      expect(existsSync(new URL(`cases/${c.id}.json`, dataDir))).toBe(true);
    }
  });

  it('decodes fields with the free stream upstream and only the body masked', () => {
    const picks = [manifest!.cases[0], manifest!.cases[Math.floor(manifest!.cases.length / 2)], manifest!.cases[manifest!.cases.length - 1]];
    for (const c of picks) {
      const record = JSON.parse(readFileSync(new URL(`cases/${c.id}.json`, dataDir), 'utf8')) as CaseRecord;
      const bytes = new Uint8Array(gunzipSync(readFileSync(new URL(`cases/${record.field.file}`, dataDir))));
      const states = decodeFields(bytes, record.field);
      expect(states).toHaveLength(record.field.states.length);
      const grid = { nx: record.field.nx, ny: record.field.ny, x0: record.field.x0, y0: record.field.y0, spacing: record.field.spacing };
      for (const s of states) {
        expect(sample(grid, s.u, -0.55, 0.6)).toBeGreaterThan(0.9);       // upstream corner: close to U_inf
        const masked = s.u.filter(Number.isNaN).length / s.u.length;
        expect(masked).toBeGreaterThan(0.01);
        expect(masked).toBeLessThan(0.03);
      }
      expect(record.coefficients.cl).toBeCloseTo(c.cl, 4);
    }
  });
});
