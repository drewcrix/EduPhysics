import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeFields, gunzip, isGzip } from '../src/data/decode';
import type { FieldMeta } from '../src/data/types';

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);

describe('field decoding', () => {
  it('decodes the fixture written by the Python encoder exactly', async () => {
    const { meta, expected } = JSON.parse(readFileSync(fixture('fields.json'), 'utf8')) as { meta: FieldMeta; expected: Record<string, (number | null)[]>[] };
    const compressed = new Uint8Array(readFileSync(fixture('fields.bin.gz')));
    expect(isGzip(compressed)).toBe(true);
    const states = decodeFields(await gunzip(compressed), meta);
    expect(states).toHaveLength(2);
    states.forEach((state, s) => {
      for (const name of ['u', 'v', 'cp'] as const) {
        state[name].forEach((v, k) => {
          const e = expected[s][name][k];
          if (e === null) expect(Number.isNaN(v)).toBe(true);
          else expect(v).toBeCloseTo(e, 5);                       // float32 storage
        });
      }
    });
  });

  it('handles data a server already inflated (no gzip header)', () => {
    const raw = new Uint8Array([1, 2, 3]);
    expect(isGzip(raw)).toBe(false);
    expect(isGzip(new Uint8Array(gzipSync(raw)))).toBe(true);
  });

  it('rejects a payload of the wrong size', () => {
    const meta: FieldMeta = { file: '', encoding: '', nx: 2, ny: 2, x0: 0, y0: 0, spacing: 1, order: ['u', 'v', 'cp'], states: ['instantaneous'], ranges: [{ u: [0, 1], v: [0, 1], cp: [0, 1] }], nan_code: 4095 };
    expect(() => decodeFields(new Uint8Array(10), meta)).toThrow(/expected 24/);
  });
});
