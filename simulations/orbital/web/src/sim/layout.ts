// Decode the packed Float64Array records streamed from the core into column series.
// The layout mirrors WasmSimulation::history / innovations; sizes come from meta.layout.
import type { Meta } from './types';

export interface HistoryColumns {
  t: number[];
  node: number[];
  xTrue: number[][]; // [component][k]
  xEst: number[][];
  xPrior: number[][];
  sigma: number[][];
  sigmaPrior: number[][];
  posCov: number[][]; // xx xy xz yy yz zz
  err: number[][];
  nees: number[];
  errRtn: number[][];
  sigmaRtn: number[][];
  uActual: number[][];
  uMeasured: number[][];
  impulse: number[];
  ess: number[];
  predictUs: number[];
  updateUs: number[];
  sensorStatus: number[][]; // [sensor][k]
}

export interface InnovationColumns {
  t: number[];
  node: number[];
  sensor: number[];
  dim: number[];
  nis: number[];
  nu: number[][]; // [component 0..5][k]
  sigma: number[][];
}

const cols = (n: number) => Array.from({ length: n }, () => [] as number[]);

export function emptyHistory(meta: Meta): HistoryColumns {
  const { stateDim: n, controlDim: m, sensorCount: S } = meta.layout;
  return {
    t: [], node: [], xTrue: cols(n), xEst: cols(n), xPrior: cols(n), sigma: cols(n), sigmaPrior: cols(n),
    posCov: cols(6), err: cols(n), nees: [], errRtn: cols(3), sigmaRtn: cols(3), uActual: cols(m), uMeasured: cols(m),
    impulse: [], ess: [], predictUs: [], updateUs: [], sensorStatus: cols(S),
  };
}

export function emptyInnovations(meta: Meta): InnovationColumns {
  const D = meta.layout.maxMeasDim;
  return { t: [], node: [], sensor: [], dim: [], nis: [], nu: cols(D), sigma: cols(D) };
}

/** Append packed history records to the column store (mutates and returns `h`). */
export function appendHistory(meta: Meta, h: HistoryColumns, packed: Float64Array): HistoryColumns {
  const { record, stateDim: n, controlDim: m, sensorCount: S } = meta.layout;
  if (packed.length % record !== 0) throw new Error(`history length ${packed.length} is not a multiple of ${record}`);
  for (let o = 0; o < packed.length; o += record) {
    let i = o;
    const take = (dst: number[][], k: number) => {
      for (let j = 0; j < k; j++) dst[j].push(packed[i++]);
    };
    h.t.push(packed[i++]);
    h.node.push(packed[i++]);
    take(h.xTrue, n);
    take(h.xEst, n);
    take(h.xPrior, n);
    take(h.sigma, n);
    take(h.sigmaPrior, n);
    take(h.posCov, 6);
    take(h.err, n);
    h.nees.push(packed[i++]);
    take(h.errRtn, 3);
    take(h.sigmaRtn, 3);
    take(h.uActual, m);
    take(h.uMeasured, m);
    h.impulse.push(packed[i++]);
    h.ess.push(packed[i++]);
    h.predictUs.push(packed[i++]);
    h.updateUs.push(packed[i++]);
    take(h.sensorStatus, S);
    if (i !== o + record) throw new Error('history layout mismatch');
  }
  return h;
}

export function appendInnovations(meta: Meta, r: InnovationColumns, packed: Float64Array): InnovationColumns {
  const stride = meta.layout.innovation;
  const D = meta.layout.maxMeasDim;
  if (packed.length % stride !== 0) throw new Error('innovation layout mismatch');
  for (let o = 0; o < packed.length; o += stride) {
    r.t.push(packed[o]);
    r.node.push(packed[o + 1]);
    r.sensor.push(packed[o + 2]);
    r.dim.push(packed[o + 3]);
    r.nis.push(packed[o + 4]);
    for (let j = 0; j < D; j++) r.nu[j].push(packed[o + 5 + j]);
    for (let j = 0; j < D; j++) r.sigma[j].push(packed[o + 5 + D + j]);
  }
  return r;
}
