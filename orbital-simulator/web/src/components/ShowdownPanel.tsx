// Filter Showdown: run every estimator on the *same* seeded scenario (identical truth and
// measurement noise) and compare accuracy, calibration and cost side by side.
import { useState } from 'react';
import { SimClient } from '../sim/client';
import { appendHistory, emptyHistory } from '../sim/layout';
import type { Summary } from '../sim/types';
import { fmt } from '../sim/units';
import { Chart, type Series } from './Chart';

const CONTESTANTS = [
  { key: 'ekf', label: 'EKF', est: { type: 'ekf' }, color: '#38e1ff' },
  { key: 'ukf', label: 'UKF', est: { type: 'ukf' }, color: '#a3e635' },
  { key: 'pf', label: 'Particle filter', est: { type: 'pf' }, color: '#a78bfa' },
  { key: 'kf-ref', label: 'Linear KF (reference)', est: { type: 'kf', kf: { linearization: 'reference' } }, color: '#fbbf24' },
  { key: 'kf-frozen', label: 'Linear KF (frozen)', est: { type: 'kf', kf: { linearization: 'frozen' } }, color: '#fb7185' },
];

interface Result {
  key: string;
  label: string;
  color: string;
  summary?: Summary;
  error?: string;
  wallMs: number;
  t: number[];
  posErr: number[];
  sigma: number[];
  messages: string[];
}

export function ShowdownPanel({ scenario, onRun, onClose }: { scenario: Record<string, unknown>; onRun: () => void; onClose: () => void }) {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  const run = async () => {
    setResults([]);
    const out: Result[] = [];
    for (const c of CONTESTANTS) {
      setRunning(c.label);
      const client = new SimClient();
      const sc = structuredClone(scenario) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      sc.estimator = { ...sc.estimator, ...c.est };
      const r: Result = { key: c.key, label: c.label, color: c.color, wallMs: 0, t: [], posErr: [], sigma: [], messages: [] };
      try {
        const init = await client.init(sc);
        if (!init.ok || !init.meta) throw new Error(init.error ?? 'init failed');
        const t0 = performance.now();
        const res = await client.runToEnd();
        r.wallMs = performance.now() - t0;
        const h = appendHistory(init.meta, emptyHistory(init.meta), res.delta.history);
        r.t = h.t;
        r.posErr = h.t.map((_, k) => Math.max(1e-3, Math.hypot(h.err[0][k], h.err[1][k], h.err[2][k])));
        r.sigma = h.t.map((_, k) => Math.max(1e-3, 3 * Math.hypot(h.sigma[0][k], h.sigma[1][k], h.sigma[2][k])));
        r.summary = await client.summary();
        r.messages = r.summary.messages ?? [];
      } catch (e) {
        r.error = e instanceof Error ? e.message : String(e);
      } finally {
        client.dispose();
      }
      out.push(r);
      setResults([...out]);
    }
    setRunning(null);
    onRun();
  };

  const ok = results.filter((r) => r.summary);
  const x = ok[0]?.t ?? [];
  const series: Series[] = ok.flatMap((r) => [
    { label: `${r.label} |error|`, color: r.color, values: r.posErr },
    { label: `${r.label} 3σ`, color: r.color, values: r.sigma, dash: [4, 4], width: 1 },
  ]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sd-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="panel max-h-[94vh] w-full max-w-5xl overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="sd-title" className="font-display text-2xl font-bold text-white">Filter Showdown</h2>
            <p className="text-sm text-slate-400">Same scenario, same seed: every filter sees identical truth and identical measurement noise. Compare <b>accuracy</b>, <b>calibration</b> (ANEES/n ≈ 1 means honest) and <b>cost</b>.</p>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close showdown">✕</button>
        </div>
        <button className="btn-primary mt-3" onClick={run} disabled={!!running}>{running ? `Running ${running}…` : results.length ? 'Run again' : 'Run showdown'}</button>
        {results.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr><th className="py-1">Estimator</th><th>pos RMS (2nd half)</th><th>final |err|</th><th>ANEES/n</th><th>verdict</th><th>ANIS/dim</th><th>dynamics evals</th><th>wall time</th><th>safeguards</th></tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const s = r.summary;
                  const v = s?.calibration?.verdict;
                  return (
                    <tr key={r.key} className="border-t border-white/5 align-top">
                      <td className="py-1.5"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.label}</td>
                      {s ? (
                        <>
                          <td className="font-mono">{fmt(s.accuracy?.positionRmsTail)} m</td>
                          <td className="font-mono">{fmt(s.accuracy?.positionFinal)} m</td>
                          <td className="font-mono">{fmt(s.calibration?.aneesPerDim)}</td>
                          <td className={v === 'consistent' ? 'text-signal-teal' : 'text-signal-amber'}>{v}</td>
                          <td className="font-mono">{fmt(s.calibration?.anisPerDim)}</td>
                          <td className="font-mono">{fmt(s.compute?.dynamicsEvaluations)}</td>
                          <td className="font-mono">{fmt(r.wallMs)} ms</td>
                          <td className="text-[11px] text-slate-400">
                            {s.compute && s.compute.particles > 0 && <>resamples {s.compute.resamples}, kernel fallbacks {s.compute.degeneracyFallbacks}, collapses {s.compute.collapses}</>}
                            {s.compute && s.compute.psdRepairs > 0 && <> PSD repairs {s.compute.psdRepairs}</>}
                            {r.messages.map((mm) => <div key={mm} className="text-violet-300">{mm}</div>)}
                          </td>
                        </>
                      ) : <td colSpan={8} className="text-rose-300">{r.error}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {ok.length > 0 && (
          <div className="mt-4">
            <Chart title="Position error (solid) vs claimed 3σ (dashed)" x={x} series={series} logY yLabel="[m]" height={300} />
            <p className="mt-2 text-[11px] text-slate-400">
              An honest filter keeps its solid line under its own dashed line. Wall time depends on your machine; dynamics evaluations are a machine-independent cost.
              The frozen KF skips nonlinear ground-station measurements (it cannot use them) — that is reported above, not hidden.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
