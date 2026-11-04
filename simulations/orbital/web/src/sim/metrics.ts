// Live metrics for the rule engine and the HUD, computed from streamed history.
import type { Metrics } from '../lessons/engine';
import type { HistoryColumns, InnovationColumns } from './layout';
import type { Meta } from './types';

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

export function sigmaRatio(cov: number[][], ref: number[][]) {
  let r = 0;
  for (let i = 0; i < cov.length; i++) r = Math.max(r, Math.sqrt(cov[i][i] / ref[i][i]));
  return r;
}

export function computeMetrics(meta: Meta, h: HistoryColumns, inn: InnovationColumns, finished: boolean): Metrics {
  const k = h.t.length - 1;
  if (k < 0) return { t: 0, progress: 0, finished: finished ? 1 : 0 };
  const t = h.t[k];
  const n = meta.layout.stateDim;
  const posSigma = Math.sqrt(h.sigma[0][k] ** 2 + h.sigma[1][k] ** 2 + h.sigma[2][k] ** 2);
  const posErr = Math.hypot(h.err[0][k], h.err[1][k], h.err[2][k]);
  const lastN = Math.max(0, inn.t.length - 5);
  const nisNorm: number[] = [];
  for (let i = lastN; i < inn.t.length; i++) nisNorm.push(inn.nis[i] / inn.dim[i]);
  let updatesRecent = 0;
  for (let i = inn.t.length - 1; i >= 0 && inn.t[i] > t - 120; i--) updatesRecent++;
  const neesRecent: number[] = [];
  for (let i = Math.max(0, k - 9); i <= k; i++) if (Number.isFinite(h.nees[i])) neesRecent.push(h.nees[i] / n);
  const outageActive = meta.sensors.some((s) => s.enabled && s.outages.some(([a, b]) => t >= a && t <= b)) ? 1 : 0;
  const assumedNoiseRatio = Math.max(0, ...meta.sensors.filter((s) => s.enabled).map((s) => sigmaRatio(s.assumedCovariance, s.trueCovariance)));
  const gimbal = meta.model === 'rigid12' && Math.abs(Math.cos(h.xEst[7][k])) < 0.045 ? 1 : 0;
  return {
    t,
    progress: t / meta.duration,
    posSigma,
    alongTrackSigma: h.sigmaRtn[1][k],
    posErr,
    nees: h.nees[k],
    neesRecentNorm: mean(neesRecent),
    nisLastNorm: nisNorm.length ? nisNorm[nisNorm.length - 1] : NaN,
    nisRecentNorm: mean(nisNorm),
    nisMaxRecentNorm: nisNorm.length ? Math.max(...nisNorm) : NaN,
    updatesRecent,
    outageActive,
    finished: finished ? 1 : 0,
    gimbal,
    sensorsEnabled: meta.sensors.filter((s) => s.enabled).length,
    assumedNoiseRatio,
  };
}
