// Client-side validation for the covariance editor. It mirrors cov::validate in C++ so
// students get instant feedback; the C++ core re-validates everything it receives.

export interface CovCheck {
  ok: boolean;
  message?: string;
}

/** Cholesky-based positive-definiteness test with a relative tolerance. */
export function choleskyOk(M: number[][], requirePd: boolean): boolean {
  const n = M.length;
  const scale = Math.max(1e-300, ...M.flat().map(Math.abs));
  // Shift slightly for semidefinite matrices so that PSD inputs pass when allowed
  const shift = requirePd ? 0 : 1e-12 * scale;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = M[i][j] + (i === j ? shift : 0);
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= (requirePd ? 1e-14 * scale : 0)) return false;
        L[i][i] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return true;
}

export function validateCovariance(M: number[][], n: number, what: string, requirePd: boolean, units: string[] = []): CovCheck {
  if (M.length !== n || M.some((r) => r.length !== n)) return { ok: false, message: `${what} must be ${n}×${n}.` };
  if (M.flat().some((v) => !Number.isFinite(v))) return { ok: false, message: `${what} contains an empty or non-numeric entry.` };
  const scale = Math.max(1e-300, ...M.flat().map(Math.abs));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (Math.abs(M[i][j] - M[j][i]) > 1e-9 * scale)
        return { ok: false, message: `${what} is not symmetric: (${i + 1},${j + 1}) ≠ (${j + 1},${i + 1}). Covariances satisfy P = Pᵀ.` };
  for (let i = 0; i < n; i++)
    if (M[i][i] < 0 || (requirePd && M[i][i] === 0))
      return { ok: false, message: `Diagonal entry ${i + 1}${units[i] ? ` (${units[i]})` : ''} must be ${requirePd ? 'positive' : 'non-negative'}: it is a variance.` };
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++)
      if (M[i][j] * M[i][j] > M[i][i] * M[j][j] * (1 + 1e-12))
        return { ok: false, message: `Entries (${i + 1},${j + 1}) imply a correlation |ρ| > 1 — reduce the off-diagonal value below √(P${i + 1}${i + 1}·P${j + 1}${j + 1}).` };
  if (!choleskyOk(M, requirePd))
    return { ok: false, message: `${what} is not positive ${requirePd ? 'definite' : 'semidefinite'}: the correlations are jointly impossible. Reduce off-diagonal entries.` };
  return { ok: true };
}
