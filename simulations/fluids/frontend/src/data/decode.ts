import type { FieldMeta, FieldState } from './types';

/** gzip member header: some static servers send .gz files with Content-Encoding and the browser
 * has already inflated them, so only decompress when the magic bytes are still present. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Inverse of eduphysics_fluids.fields.encode: uint16 little endian, each row stored as its first
 * code then successive differences modulo 2^16; codes 0..nan_code-1 map linearly onto [lo, hi].
 */
export function decodeFields(bytes: Uint8Array, meta: FieldMeta): FieldState[] {
  const { nx, ny, nan_code: nan } = meta;
  const n = nx * ny;
  const expected = meta.states.length * meta.order.length * n * 2;
  if (bytes.byteLength !== expected) {
    throw new Error(`Field data has ${bytes.byteLength} bytes, expected ${expected}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const states: FieldState[] = [];
  let offset = 0;
  for (let s = 0; s < meta.states.length; s++) {
    const state: Record<string, Float32Array> = {};
    for (const name of meta.order) {
      const [lo, hi] = meta.ranges[s][name];
      const scale = (hi - lo) / (nan - 1);
      const out = new Float32Array(n);
      for (let j = 0; j < ny; j++) {
        let code = 0;
        for (let i = 0; i < nx; i++) {
          code = (code + view.getUint16(offset, true)) & 0xffff;
          offset += 2;
          out[j * nx + i] = code === nan ? NaN : lo + code * scale;
        }
      }
      state[name] = out;
    }
    states.push(state as unknown as FieldState);
  }
  return states;
}
