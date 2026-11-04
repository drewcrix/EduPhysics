// Right-hand lesson column: briefing → prediction → interactive objectives → reasoning
// question → debrief. All text comes from the lesson JSON.
import { useState } from 'react';
import type { Lesson, Question } from '../lessons/schema';
import { evaluate } from '../lessons/engine';
import type { Mission } from '../sim/useMission';
import { BotAvatar, BotBubble } from './Bot';
import { Markdown } from './Markdown';

export function QuestionCard({ q, answer, onAnswer, reveal, title }: { q: Question; answer?: string; onAnswer: (id: string, correct: boolean) => void; reveal: boolean; title: string }) {
  const chosen = q.options.find((o) => o.id === answer);
  return (
    <div className="rounded-lg border border-signal-violet/30 bg-violet-950/20 p-3">
      <div className="label mb-1 text-violet-300">{title}</div>
      <Markdown>{q.prompt}</Markdown>
      <div className="mt-2 space-y-1.5" role="radiogroup" aria-label={title}>
        {q.options.map((o) => {
          const sel = answer === o.id;
          const tone = reveal && sel ? (o.correct ? 'border-signal-teal/70 bg-teal-950/40' : 'border-rose-400/60 bg-rose-950/30') : sel ? 'border-signal-cyan/60 bg-white/10' : 'border-white/10 hover:bg-white/5';
          return (
            <button key={o.id} role="radio" aria-checked={sel} disabled={!!answer} className={`w-full rounded-md border px-2.5 py-1.5 text-left text-sm text-slate-200 ${tone}`} onClick={() => onAnswer(o.id, o.correct)}>
              <Markdown className="!text-slate-200">{o.text}</Markdown>
            </button>
          );
        })}
      </div>
      {chosen && !reveal && <p className="mt-2 text-xs text-slate-400">Prediction locked in. Run the mission — we'll check it in the debrief.</p>}
      {chosen && reveal && (
        <div className="mt-2 text-xs">
          <Markdown className={chosen.correct ? '!text-teal-200' : '!text-rose-200'}>{`${chosen.correct ? '✓' : '✗'} ${chosen.feedback}`}</Markdown>
          {q.explanation && <Markdown className="mt-1">{q.explanation}</Markdown>}
        </div>
      )}
    </div>
  );
}

interface Props {
  m: Mission;
  lesson: Lesson;
  prediction?: string;
  onPrediction: (id: string, correct: boolean) => void;
  reasoning?: string;
  onReasoning: (id: string, correct: boolean) => void;
  onDebrief: () => void;
  botName: string;
}

export function LessonPanel({ m, lesson, prediction, onPrediction, reasoning, onReasoning, onDebrief, botName }: Props) {
  const [tab, setTab] = useState<'mission' | 'orbi' | 'concepts'>('mission');
  const [briefOpen, setBriefOpen] = useState(true);
  const [hintsShown, setHintsShown] = useState(0);
  const finished = m.status?.finished ?? false;
  const last = m.messages.at(-1);
  const metrics = m.currentMetrics();
  const availableHints = lesson.hints.filter((h) => !h.when || evaluate(h.when, { metrics, flags: m.engine.flags }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="panel p-3">
        <div className="flex items-start gap-3">
          <BotAvatar mood={last?.mood ?? 'happy'} size={56} />
          <div className="min-w-0 flex-1" aria-live="polite">
            {last ? <BotBubble message={last} name={botName} /> : <p className="text-sm text-slate-400">ORBI is watching the console.</p>}
          </div>
        </div>
      </div>
      <div className="panel flex min-h-0 flex-1 flex-col">
        <div role="tablist" className="flex gap-1 border-b border-white/5 px-2 pt-2">
          {(['mission', 'orbi', 'concepts'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`rounded-t-md px-2.5 py-1 text-xs font-medium capitalize ${tab === t ? 'bg-white/10 text-white' : 'text-slate-400'}`} onClick={() => setTab(t)}>
              {t === 'orbi' ? `${botName} log` : t}{t === 'concepts' && m.concepts.length ? ` (${m.concepts.length})` : ''}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {tab === 'mission' && (
            <>
              <div>
                <button className="flex w-full items-center justify-between text-left" onClick={() => setBriefOpen(!briefOpen)} aria-expanded={briefOpen}>
                  <span className="font-display text-base font-semibold text-white">{lesson.codename} · {lesson.title}</span>
                  <span className="text-slate-500">{briefOpen ? '▾' : '▸'}</span>
                </button>
                {briefOpen && <Markdown className="mt-1">{lesson.briefing.markdown}</Markdown>}
              </div>
              <QuestionCard q={lesson.prediction} answer={prediction} onAnswer={onPrediction} reveal={finished} title="Predict before you run" />
              {prediction && (
                <>
                  <div>
                    <div className="label mb-1">Your task</div>
                    <Markdown>{lesson.interactive.instructions}</Markdown>
                    {lesson.interactive.steps.length > 0 && (
                      <ol className="ml-4 mt-1 list-decimal text-sm text-slate-300">{lesson.interactive.steps.map((s) => <li key={s}><Markdown>{s}</Markdown></li>)}</ol>
                    )}
                  </div>
                  <div>
                    <div className="label mb-1">Objectives</div>
                    <ul className="space-y-1">
                      {lesson.objectives.map((o) => {
                        const done = m.objectivesDone.includes(o.id);
                        return (
                          <li key={o.id} className={`flex items-start gap-2 text-sm ${done ? 'text-signal-teal' : 'text-slate-300'}`}>
                            <span aria-hidden className="mt-0.5">{done ? '✓' : '○'}</span>
                            <span>{o.text}{!o.required && <span className="text-slate-500"> (bonus)</span>}<span className="sr-only">{done ? ' — complete' : ' — not yet'}</span></span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  {availableHints.length > 0 && (
                    <div>
                      {availableHints.slice(0, hintsShown).map((h) => <Markdown key={h.id} className="rounded-md bg-white/5 p-2 !text-amber-100">{`💡 ${h.text}`}</Markdown>)}
                      {hintsShown < availableHints.length && <button className="btn-ghost mt-1 px-2 py-0.5 text-xs" onClick={() => setHintsShown(hintsShown + 1)}>Show a hint</button>}
                    </div>
                  )}
                </>
              )}
              {finished && prediction && (
                <>
                  <QuestionCard q={lesson.reasoning} answer={reasoning} onAnswer={onReasoning} reveal={!!reasoning} title="Reasoning check" />
                  <button className="btn-primary w-full" onClick={onDebrief} disabled={!reasoning}>{reasoning ? 'Open debrief' : 'Answer to unlock the debrief'}</button>
                </>
              )}
            </>
          )}
          {tab === 'orbi' && (
            <ul className="space-y-2">
              {[...m.messages].reverse().map((msg) => (
                <li key={msg.id} className="rounded-md border border-white/5 bg-white/5 p-2">
                  <div className="text-[10px] text-slate-500">{msg.t !== undefined ? `t = ${Math.round(msg.t)} s` : ''}</div>
                  <Markdown>{msg.text}</Markdown>
                </li>
              ))}
              {!m.messages.length && <li className="text-sm text-slate-400">No messages yet.</li>}
            </ul>
          )}
          {tab === 'concepts' && <ConceptList m={m} />}
        </div>
      </div>
    </div>
  );
}

export function ConceptList({ m }: { m: Mission }) {
  if (!m.concepts.length) return <p className="text-sm text-slate-400">Concept cards appear here when something relevant happens. The full set is in the Field Guide.</p>;
  return (
    <ul className="space-y-2">
      {m.concepts.map((c) => (
        <li key={c.id} className="rounded-lg border border-signal-cyan/20 bg-white/[0.03] p-2.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-white">{c.title}</h3>
            <button className="text-xs text-slate-500 hover:text-slate-200" onClick={() => m.dismissConcept(c.id)} aria-label={`Dismiss ${c.title}`}>✕</button>
          </div>
          <details>
            <summary className="cursor-pointer text-xs text-slate-400">{c.summary}</summary>
            <Markdown className="mt-1">{c.body}</Markdown>
          </details>
        </li>
      ))}
    </ul>
  );
}
