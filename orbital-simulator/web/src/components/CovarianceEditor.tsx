// Advanced symmetric covariance editor. Editing (i, j) mirrors to (j, i), so the matrix is
// symmetric by construction; validation explains PSD/PD failures before anything is sent.
import { useState } from 'react';
import { validateCovariance } from '../sim/covariance';
import type { ComponentLabel } from '../sim/types';

interface Props {
  title: string;
  labels: ComponentLabel[];
  unitSuffix?: string; // e.g. "²" for variances of a measurement
  initial: number[][];
  requirePd: boolean;
  onApply: (M: number[][]) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

export function CovarianceEditor({ title, labels, unitSuffix = '²', initial, requirePd, onApply, onClose }: Props) {
  const n = initial.length;
  const [text, setText] = useState(() => initial.map((r) => r.map((v) => String(Number(v.toPrecision(6))))));
  const [serverError, setServerError] = useState<string | null>(null);
  const M = text.map((r) => r.map((v) => (v.trim() === '' ? NaN : Number(v))));
  const units = labels.map((l) => `${l.unit}${unitSuffix}`);
  const check = validateCovariance(M, n, title, requirePd, units);

  const set = (i: number, j: number, v: string) => {
    setServerError(null);
    setText((t) => t.map((r, a) => r.map((x, b) => ((a === i && b === j) || (a === j && b === i) ? v : x))));
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Edit ${title}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="panel max-h-[90vh] w-full max-w-3xl overflow-auto p-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
            <p className="text-xs text-slate-400">Symmetric by construction: editing an off-diagonal entry updates its mirror. Units: row × column ({units.join(', ')} on the diagonal).</p>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close editor">✕</button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="border-separate border-spacing-1 text-xs">
            <thead>
              <tr><th />{labels.map((l) => <th key={l.name} className="px-1 font-mono text-slate-400">{l.name}</th>)}</tr>
            </thead>
            <tbody>
              {text.map((row, i) => (
                <tr key={i}>
                  <th className="pr-1 text-right font-mono text-slate-400">{labels[i].name}</th>
                  {row.map((v, j) => (
                    <td key={j}>
                      <input aria-label={`entry ${labels[i].name}, ${labels[j].name}`} className={`field w-24 font-mono ${i === j ? 'border-signal-cyan/30' : ''} ${j < i ? 'opacity-60' : ''}`}
                        value={v} onChange={(e) => set(i, j, e.target.value)} inputMode="decimal" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 min-h-[2.5rem] text-sm" aria-live="polite">
          {check.ok ? <span className="text-signal-teal">✓ Valid {requirePd ? 'positive-definite' : 'positive-semidefinite'} covariance.</span>
                    : <span className="text-rose-300">✗ {check.message}</span>}
          {serverError && <div className="text-rose-300">Core rejected it: {serverError}</div>}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setText(initial.map((r) => r.map((v) => String(Number(v.toPrecision(6))))))}>Reset</button>
          <button className="btn-primary" disabled={!check.ok} onClick={async () => {
            const r = await onApply(M);
            if (r.ok) onClose();
            else setServerError(r.error ?? 'unknown error');
          }}>Apply</button>
        </div>
      </div>
    </div>
  );
}
