// Mission debrief: four separate scores, truth reveal, prediction check and authored debrief.
import type { Lesson } from '../lessons/schema';
import type { Scores } from '../sim/scoring';
import type { Summary } from '../sim/types';
import { fmt } from '../sim/units';
import { Markdown } from './Markdown';

function Gauge({ label, value, hint }: { label: string; value: number; hint: string }) {
  const r = 28, c = 2 * Math.PI * r;
  const color = value >= 80 ? '#2dd4bf' : value >= 50 ? '#fbbf24' : '#fb7185';
  return (
    <div className="flex flex-col items-center text-center">
      <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`${label} score ${Math.round(value)} out of 100`}>
        <circle cx="38" cy="38" r={r} stroke="rgba(148,163,184,0.15)" strokeWidth="7" fill="none" />
        <circle cx="38" cy="38" r={r} stroke={color} strokeWidth="7" fill="none" strokeDasharray={`${(value / 100) * c} ${c}`} strokeLinecap="round" transform="rotate(-90 38 38)" />
        <text x="38" y="43" textAnchor="middle" fill="#f8fafc" fontSize="16" fontWeight="700">{Math.round(value)}</text>
      </svg>
      <div className="mt-1 text-xs font-semibold text-slate-200">{label}</div>
      <div className="text-[10px] text-slate-500">{hint}</div>
    </div>
  );
}

interface Props {
  lesson?: Lesson;
  summary: Summary;
  scores: Scores;
  prediction?: { correct: boolean; feedback: string };
  truthWasHidden: boolean;
  success: boolean;
  onClose: () => void;
  onRetry: () => void;
  onNext?: () => void;
  onSave: () => void;
}

export function DebriefModal({ lesson, summary, scores, prediction, truthWasHidden, success, onClose, onRetry, onNext, onSave }: Props) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="debrief-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="panel max-h-[92vh] w-full max-w-3xl overflow-y-auto p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-xs text-signal-cyan">{lesson?.codename ?? 'SANDBOX'} · DEBRIEF</div>
            <h2 id="debrief-title" className="font-display text-2xl font-bold text-white">{lesson?.title ?? 'Run summary'}</h2>
            <p className={`mt-1 text-sm font-semibold ${success ? 'text-signal-teal' : 'text-signal-amber'}`}>
              {success ? `Mission success. ${lesson?.scoring.successMessage ?? ''}` : 'Mission incomplete — some required objectives were not met.'}
            </p>
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close debrief" autoFocus>✕</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Gauge label="Accuracy" value={scores.accuracy} hint="tail position RMS vs target" />
          <Gauge label="Calibration" value={scores.calibration} hint={`honest uncertainty (${scores.verdict})`} />
          <Gauge label="Resources" value={scores.resources} hint="tracking cost vs budget" />
          <Gauge label="Objectives" value={scores.success} hint="required objectives met" />
        </div>
        <p className="mt-2 text-center text-[11px] text-slate-500">Scores are reported separately on purpose: a filter can't earn calibration points by claiming a tiny covariance, or accuracy points by being lucky.</p>
        <table className="mt-4 w-full text-sm">
          <tbody>
            {scores.details.map((d) => <tr key={d.label} className="border-t border-white/5"><td className="py-1 text-slate-400">{d.label}</td><td className="py-1 text-right font-mono text-slate-200">{d.value}</td></tr>)}
            <tr className="border-t border-white/5"><td className="py-1 text-slate-400">Estimator</td><td className="py-1 text-right text-slate-200">{summary.estimator.name}</td></tr>
            <tr className="border-t border-white/5"><td className="py-1 text-slate-400">Compute</td><td className="py-1 text-right font-mono text-slate-200">{fmt(summary.compute?.dynamicsEvaluations)} f-evals · {fmt((summary.compute?.predictMs ?? 0) + (summary.compute?.updateMs ?? 0))} ms</td></tr>
            <tr className="border-t border-white/5"><td className="py-1 text-slate-400">Replay hash</td><td className="py-1 text-right font-mono text-xs text-slate-400">{summary.hash}</td></tr>
          </tbody>
        </table>
        {truthWasHidden && <p className="mt-3 rounded-md bg-teal-950/40 p-2 text-sm text-teal-100">Truth is now revealed in the 3-D view and the Errors/NEES plots.</p>}
        {prediction && (
          <div className={`mt-3 rounded-md p-2 text-sm ${prediction.correct ? 'bg-teal-950/40 text-teal-100' : 'bg-rose-950/40 text-rose-100'}`}>
            <strong>Your prediction:</strong> <Markdown className="inline !text-inherit">{prediction.feedback}</Markdown>
          </div>
        )}
        {(summary.messages?.length ?? 0) > 0 && (
          <ul className="mt-3 list-disc pl-5 text-xs text-slate-400">{summary.messages!.map((m) => <li key={m}>{m}</li>)}</ul>
        )}
        {lesson && (
          <div className="mt-4 border-t border-white/10 pt-3">
            {lesson.debrief.placeholder && <span className="chip mb-2">author placeholder — expand in content/lessons</span>}
            <Markdown>{lesson.debrief.markdown}</Markdown>
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={onSave}>Save replay</button>
          <button className="btn-ghost" onClick={onRetry}>Retry</button>
          {onNext && <button className="btn-primary" onClick={onNext}>Next mission →</button>}
        </div>
      </div>
    </div>
  );
}
