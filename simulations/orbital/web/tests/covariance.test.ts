import { describe, expect, it } from 'vitest';
import { validateCovariance } from '../src/sim/covariance';
import { computeScores } from '../src/sim/scoring';
import type { Summary } from '../src/sim/types';

describe('covariance editor validation', () => {
  it('accepts valid matrices and rejects invalid ones with a reason', () => {
    expect(validateCovariance([[4, 1], [1, 9]], 2, 'R', true).ok).toBe(true);
    expect(validateCovariance([[4, 1], [2, 9]], 2, 'R', true).message).toMatch(/symmetric/);
    expect(validateCovariance([[1, 2], [2, 1]], 2, 'R', true).message).toMatch(/correlation/);
    expect(validateCovariance([[0, 0], [0, 1]], 2, 'R', true).ok).toBe(false);
    expect(validateCovariance([[0, 0], [0, 1]], 2, 'Q', false).ok).toBe(true);
    expect(validateCovariance([[1, 0.9, 0.9], [0.9, 1, -0.9], [0.9, -0.9, 1]], 3, 'R', true).message).toMatch(/jointly impossible/);
    expect(validateCovariance([[1, 0], [0, NaN]], 2, 'R', true).ok).toBe(false);
    expect(validateCovariance([[1]], 2, 'R', true).ok).toBe(false);
  });
});

describe('scoring', () => {
  const base: Summary = {
    ok: true, estimator: { type: 'ekf', name: 'EKF' }, nodes: 10, time: 100, finished: true,
    accuracy: { positionRms: 3, positionRmsTail: 2, positionFinal: 2, positionMax: 5, velocityRms: 0.1, velocityFinal: 0.01, finalSigmaPosition: 2 },
    calibration: { stateDim: 6, neesSamples: 10, aneesPerDim: 1, verdict: 'consistent' },
    resources: { sensors: [], totalCost: 100 },
  };
  const opts = { accuracyTargetM: 5, resourceBudget: 200, objectivesMet: 2, objectivesRequired: 2 };
  it('scores categories separately', () => {
    const s = computeScores(base, opts);
    expect(s.accuracy).toBe(100);
    expect(s.calibration).toBeCloseTo(100);
    expect(s.resources).toBe(100);
    expect(s.success).toBe(100);
  });
  it('never rewards a filter for claiming a tiny covariance', () => {
    const over = computeScores({ ...base, calibration: { ...base.calibration!, aneesPerDim: 50 } }, opts);
    const under = computeScores({ ...base, calibration: { ...base.calibration!, aneesPerDim: 0.02 } }, opts);
    expect(over.calibration).toBeLessThan(5);
    expect(under.calibration).toBeLessThan(5);
    expect(computeScores({ ...base, calibration: { ...base.calibration!, aneesPerDim: 2 } }, opts).calibration).toBeCloseTo(100);
    expect(computeScores({ ...base, calibration: { ...base.calibration!, aneesPerDim: 4 } }, opts).calibration).toBeCloseTo(50);
    expect(computeScores({ ...base, calibration: { ...base.calibration!, aneesPerDim: 0.25 } }, opts).calibration).toBeCloseTo(50);
  });
  it('penalises inaccuracy and overspending proportionally', () => {
    expect(computeScores({ ...base, accuracy: { ...base.accuracy!, positionRmsTail: 10 } }, opts).accuracy).toBeCloseTo(50);
    expect(computeScores({ ...base, resources: { sensors: [], totalCost: 400 } }, opts).resources).toBeCloseTo(50);
  });
});

import { symEig3, unpackCov } from '../src/sim/linalg';
describe('3×3 symmetric eigen-decomposition for ellipsoids', () => {
  it('reconstructs the matrix with orthonormal eigenvectors, descending eigenvalues', () => {
    const A = unpackCov([400, 120, 10, 100, -5, 25]);
    const { values, vectors: V } = symEig3(A);
    expect(values[0]).toBeGreaterThanOrEqual(values[1]);
    expect(values[1]).toBeGreaterThanOrEqual(values[2]);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let s = 0, d = 0;
        for (let k = 0; k < 3; k++) {
          s += V[k][i] * V[k][j];
          d += V[i][k] * values[k] * V[j][k];
        }
        expect(s).toBeCloseTo(i === j ? 1 : 0, 10);
        expect(d).toBeCloseTo(A[i][j], 8);
      }
  });
});
