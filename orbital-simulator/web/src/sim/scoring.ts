// Mission scores. Accuracy, calibration, resource use and mission success are reported
// separately so that no single number can reward a filter for claiming a tiny covariance.
import type { Summary } from './types';

export interface Scores {
  accuracy: number;     // 0..100: 100 if tail RMS ≤ target, target/RMS otherwise
  calibration: number;  // 0..100: 100 for ANEES/n in [0.5, 2], decaying symmetrically outside
  resources: number;    // 0..100: 100 within budget, budget/cost otherwise
  success: number;      // 0..100: share of required objectives met
  verdict: string;
  details: { label: string; value: string }[];
}

export function computeScores(
  s: Summary,
  opts: { accuracyTargetM: number; resourceBudget: number; objectivesMet: number; objectivesRequired: number },
): Scores {
  const rms = s.accuracy?.positionRmsTail ?? Infinity;
  const accuracy = rms <= opts.accuracyTargetM ? 100 : (100 * opts.accuracyTargetM) / rms;
  const ratio = s.calibration?.aneesPerDim;
  // Dead band [0.5, 2] absorbs the run-to-run spread of a consistent filter; outside it the
  // score decays the same way for over- and under-confidence (tiny covariances never win)
  const calibration = ratio && Number.isFinite(ratio) && ratio > 0 ? 100 * Math.exp(-Math.max(0, Math.abs(Math.log(ratio)) - Math.LN2)) : 0;
  const cost = s.resources?.totalCost ?? 0;
  const resources = cost <= opts.resourceBudget ? 100 : (100 * opts.resourceBudget) / cost;
  const success = opts.objectivesRequired ? (100 * opts.objectivesMet) / opts.objectivesRequired : 100;
  const fmt = (v: number | undefined, d = 2) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
  return {
    accuracy: Math.max(0, Math.min(100, accuracy)),
    calibration: Math.max(0, Math.min(100, calibration)),
    resources: Math.max(0, Math.min(100, resources)),
    success,
    verdict: s.calibration?.verdict ?? 'n/a',
    details: [
      { label: 'Position RMS (2nd half)', value: `${fmt(rms)} m (target ${opts.accuracyTargetM} m)` },
      { label: 'ANEES / n', value: `${fmt(ratio)} (1 = honest uncertainty)` },
      { label: 'ANIS / dim', value: fmt(s.calibration?.anisPerDim) },
      { label: 'Tracking cost', value: `${fmt(cost, 0)} (budget ${opts.resourceBudget})` },
    ],
  };
}
