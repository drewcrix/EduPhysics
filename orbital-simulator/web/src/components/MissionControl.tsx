// The mission-control screen: top bar (playback), left console, 3-D view + plots, and the
// lesson / assistant column. Used for guided missions and the free sandbox.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Content } from '../lessons/content';
import type { Lesson } from '../lessons/schema';
import type { Progress } from '../lessons/progress';
import { useMission, type ReplayFile } from '../sim/useMission';
import { computeScores } from '../sim/scoring';
import { fmt, fmtDistance, fmtTime } from '../sim/units';
import { navigate } from '../App';
import { ControlsPanel } from './ControlsPanel';
import { OrbitView } from './OrbitView';
import { OrbitPlane2D, webglAvailable } from './OrbitPlane2D';
import { ErrorBoundary } from './ErrorBoundary';
import { PlotPanel, type Chi2Table } from './PlotPanel';
import { LessonPanel, ConceptList } from './LessonPanel';
import { DebriefModal } from './DebriefModal';
import { ShowdownPanel } from './ShowdownPanel';
import { ScenarioEditor } from './ScenarioEditor';
import { BotAvatar, BotBubble } from './Bot';

interface Props {
  content: Content;
  lesson?: Lesson;
  sandboxScenario?: string;
  progress: Progress;
  onProgress: (p: Progress) => void;
}

const SPEEDS = [1, 10, 60, 300, 1000];

function useReducedMotion() {
  const [r, setR] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const on = () => setR(mq.matches);
    mq?.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  }, []);
  return r;
}

function download(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function MissionControl({ content, lesson, sandboxScenario, progress, onProgress }: Props) {
  const [variant, setVariant] = useState(0);
  const scenarioId = lesson ? (lesson.variants[variant]?.scenario ?? lesson.scenario) : sandboxScenario!;
  const [seedOverride, setSeedOverride] = useState<number | null>(null);
  const [edited, setEdited] = useState<Record<string, unknown> | null>(null);
  const scenario = useMemo(() => {
    const s = structuredClone(edited ?? content.scenarios[scenarioId]) as Record<string, unknown>;
    if (seedOverride !== null) s.seed = seedOverride;
    return s;
  }, [content.scenarios, scenarioId, seedOverride, edited]);
  const opts = useMemo(() => ({
    scenario, lesson, globalRules: content.globalRules, dialogue: content.dialogue, concepts: content.concepts,
    truthVisible: lesson ? lesson.truthVisible : true,
  }), [scenario, lesson, content]);
  const m = useMission(opts);
  const reduced = useReducedMotion();
  const sandbox = !lesson;
  const allowed = useCallback((c: string) => sandbox || (lesson!.interactive.controls as string[]).includes(c), [sandbox, lesson]);

  const [prediction, setPrediction] = useState<string>();
  const [reasoning, setReasoning] = useState<string>();
  const [debrief, setDebrief] = useState(false);
  const [showdown, setShowdown] = useState(false);
  const [confidence, setConfidence] = useState(0.99);
  const [follow, setFollow] = useState(false);
  const [mag, setMag] = useState(1);
  const [predicted, setPredicted] = useState<Float64Array | null>(null);
  const [particles, setParticles] = useState<Float64Array | null>(null);
  const [chi2, setChi2] = useState<Map<string, number>>(new Map());
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFetch = useRef(0);
  const truthWasHidden = useRef(lesson ? !lesson.truthVisible : false);
  const [gl] = useState(webglAvailable);

  useEffect(() => {
    document.title = `${lesson?.title ?? 'Sandbox'} — Mission Control Academy`;
  }, [lesson]);

  // χ² quantiles from the C++ core (single tested implementation)
  useEffect(() => {
    if (!m.meta || !m.client.current) return;
    const c = m.client.current;
    const ks = [...new Set([1, 2, 3, 6, m.meta.layout.stateDim, ...m.meta.sensors.map((s) => s.dim)])];
    const ps = [0.025, 0.975, 0.95, 0.99];
    void Promise.all(ks.flatMap((k) => ps.map(async (p) => [`${p}|${k}`, await c.chi2(p, k)] as const))).then((e) => setChi2(new Map(e)));
  }, [m.meta, m.client]);
  const chi2Table: Chi2Table = useMemo(() => ({ get: (p, k) => chi2.get(`${p}|${k}`) ?? NaN }), [chi2]);
  const k3 = Math.sqrt(chi2Table.get(confidence, 3));

  // Predicted path and particle cloud refresh (throttled; display only)
  useEffect(() => {
    const c = m.client.current;
    if (!c || !m.meta) return;
    const now = performance.now();
    if (now - lastFetch.current < 500 && m.playing) return;
    lastFetch.current = now;
    const horizon = m.meta.model === 'cw6' ? 5700 : Math.min(6000, 2 * Math.PI * Math.sqrt(Math.pow(6.9e6, 3) / m.meta.mu));
    void c.predict(horizon, 160).then(setPredicted).catch(() => {});
    if (m.meta.estimator.type === 'pf') void c.particles(400).then(setParticles).catch(() => {});
    else setParticles(null);
  }, [m.version, m.meta, m.client, m.playing]);

  // Keyboard shortcuts (ignored while typing)
  const canRun = !lesson || !!prediction;
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!canRun) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (m.playing) m.pause();
        else m.play();
      } else if (e.key === 'n' || e.key === 'N') void m.stepNode();
      else if (e.key === 'p' || e.key === 'P') void m.stepPhase('predict');
      else if (e.key === 'u' || e.key === 'U') void m.stepPhase('update');
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [m, canRun]);

  // Scores and progress once the debrief can be computed
  const objectivesReq = lesson?.objectives.filter((o) => o.required) ?? [];
  const objectivesMet = objectivesReq.filter((o) => m.objectivesDone.includes(o.id)).length;
  const scores = m.summary ? computeScores(m.summary, {
    accuracyTargetM: lesson?.scoring.accuracyTargetM ?? 50,
    resourceBudget: lesson?.scoring.resourceBudget ?? 1e9,
    objectivesMet, objectivesRequired: objectivesReq.length,
  }) : null;
  const success = objectivesMet === objectivesReq.length;

  const openDebrief = () => {
    setDebrief(true);
    if (!m.truthVisible) m.setTruthVisible(true);
    if (lesson && scores) {
      const prev = progress[lesson.id];
      const best = prev?.best ? {
        accuracy: Math.max(prev.best.accuracy, scores.accuracy), calibration: Math.max(prev.best.calibration, scores.calibration),
        resources: Math.max(prev.best.resources, scores.resources), success: Math.max(prev.best.success, scores.success),
      } : { accuracy: scores.accuracy, calibration: scores.calibration, resources: scores.resources, success: scores.success };
      onProgress({ ...progress, [lesson.id]: { completed: (prev?.completed ?? false) || success, best, attempts: (prev?.attempts ?? 0) + 1 } });
    }
  };
  useEffect(() => {
    if (sandbox && m.summary) setDebrief(true);
  }, [sandbox, m.summary]);

  const save = async () => {
    const r = await m.saveReplay();
    if (r) download(`${scenarioId}-replay.json`, r);
  };
  const load = async (f: File) => {
    try {
      const data = JSON.parse(await f.text()) as ReplayFile;
      setPrediction(prediction ?? 'replay');
      await m.loadReplay(data);
    } catch (e) {
      m.say(`Could not load that replay: ${e instanceof Error ? e.message : String(e)}`, 'alert');
    }
  };
  const onHelp = (topic: string) => {
    const id = content.dialogue.controlHelp[topic];
    const line = id ? content.dialogue.lines[id] : undefined;
    if (line) m.say(line.text, line.mood);
  };

  const nextLesson = lesson ? content.lessons.find((l) => l.order > lesson.order) : undefined;
  const h = m.history;
  const k = (h?.t.length ?? 0) - 1;
  const meta = m.meta;

  if (m.error && !meta) {
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <p className="text-rose-300">The scenario could not start: {m.error}</p>
        <button className="btn-primary mt-4" onClick={() => navigate('/')}>Back</button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-space-950/80 px-3 py-2 backdrop-blur">
        <button className="btn-ghost px-2" onClick={() => navigate('/')} aria-label="Back to the academy">←</button>
        <div className="mr-2 min-w-0">
          <div className="font-mono text-[10px] text-signal-cyan">{lesson?.codename ?? 'SANDBOX'} · {meta?.model}</div>
          <div className="truncate font-display text-sm font-semibold text-white">{lesson?.title ?? meta?.name ?? '…'}</div>
        </div>
        {lesson && lesson.variants.length > 1 && (
          <select className="field w-auto" value={variant} onChange={(e) => setVariant(Number(e.target.value))} aria-label="Experiment variant">
            {lesson.variants.map((v, i) => <option key={v.id} value={i}>{v.label}</option>)}
          </select>
        )}
        {sandbox && (
          <select className="field w-auto" value={scenarioId} onChange={(e) => navigate(`/sandbox/${e.target.value}`)} aria-label="Scenario preset">
            {Object.values(content.scenarios).map((s) => <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}
          </select>
        )}
        <div className={`flex items-center gap-1 rounded-lg ${m.highlights.has('playback') || m.highlights.has('phaseStep') ? 'highlight-ring' : ''}`} title={canRun ? '' : 'Make your prediction first'}>
          <button className="btn-primary w-20" disabled={!canRun || m.status?.finished} onClick={() => (m.playing ? m.pause() : m.play())} aria-label={m.playing ? 'Pause' : 'Play'}>
            {m.playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button className="btn-ghost" disabled={!canRun || m.playing || m.status?.finished} onClick={() => void m.stepNode()} title="Step one node (N)">Step <span className="kbd">N</span></button>
          <button className="btn-ghost" disabled={!canRun || m.playing || m.status?.finished || m.status?.phase !== 'predict'} onClick={() => void m.stepPhase('predict')} title="Prediction phase only (P)">Predict <span className="kbd">P</span></button>
          <button className="btn-ghost" disabled={!canRun || m.playing || m.status?.phase !== 'update'} onClick={() => void m.stepPhase('update')} title="Measurement update phase (U)">Update <span className="kbd">U</span></button>
        </div>
        <label className="flex items-center gap-1 text-xs text-slate-400">Speed
          <select className="field w-auto py-0.5" value={m.speed} onChange={(e) => m.setSpeed(Number(e.target.value))} aria-label="Playback speed (simulated seconds per second)">
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-400"><input type="checkbox" checked={m.pauseAtUpdate} onChange={(e) => m.setPauseAtUpdate(e.target.checked)} />pause before each update</label>
        <button className="btn-ghost" onClick={() => {
          m.reset();
          setReasoning(undefined);
          setDebrief(false);
        }}>↺ Reset</button>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-slate-200" aria-live="off">t = {fmtTime(m.status?.t ?? 0)} / {fmtTime(meta?.duration ?? 0)}</span>
          <span className={`chip ${m.status?.phase === 'update' ? 'text-signal-amber' : 'text-signal-cyan'}`}>next: {m.status?.phase ?? '—'}</span>
          {(allowed('truthToggle')) && <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={m.truthVisible} onChange={(e) => m.setTruthVisible(e.target.checked)} />truth</label>}
          <select className="field w-auto py-0.5" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} aria-label="Confidence level">
            <option value={0.95}>95%</option><option value={0.99}>99%</option>
          </select>
          <button className="btn-ghost" onClick={save}>Save</button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()}>Load</button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          {(sandbox || lesson?.id === 'filter-showdown') && <button className="btn-amber" onClick={() => setShowdown(true)}>Showdown</button>}
          {m.summary && <button className="btn-primary" onClick={openDebrief} disabled={!!lesson && !reasoning}>Debrief</button>}
        </div>
      </header>
      {m.replayCheck && <div className="bg-teal-950/70 px-3 py-1 text-xs text-teal-100" role="status">{m.replayCheck}</div>}
      {m.error && meta && <div className="bg-rose-950/70 px-3 py-1 text-xs text-rose-100" role="alert">{m.error}</div>}

      {!meta || !h || !m.innovations ? (
        <div className="flex flex-1 items-center justify-center text-slate-400" role="status">Loading the C++ simulation core…</div>
      ) : (
        <div className="grid flex-1 gap-2 p-2 lg:min-h-0 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
          <aside className="order-2 space-y-2 lg:order-1 lg:min-h-0 lg:overflow-y-auto" aria-label="Console controls">
            {sandbox && (
              <section className="panel p-3 text-xs text-slate-300">
                <div className="label mb-1">Seeds (deterministic)</div>
                <div className="flex items-end gap-2">
                  <label className="flex-1">truth & sensor noise
                    <input className="field" type="number" defaultValue={meta.seed} onKeyDown={(e) => e.key === 'Enter' && setSeedOverride(Number((e.target as HTMLInputElement).value))} /></label>
                  <button className="btn-ghost" onClick={() => setSeedOverride(Math.floor(Math.random() * 1e6))}>🎲</button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Press Enter to restart with that seed. Same seed + same actions = identical run.</p>
              </section>
            )}
            {sandbox && <ScenarioEditor key={JSON.stringify(scenario).length} scenario={scenario} onApply={(s) => {
              setSeedOverride(null);
              setEdited(s);
            }} />}
            <ControlsPanel m={m} allowed={allowed} onHelp={onHelp} />
          </aside>

          <main className="order-1 grid gap-2 lg:order-2 lg:min-h-0 lg:grid-rows-[minmax(260px,1.1fr)_minmax(240px,1fr)]">
            <div className={`panel relative h-[46vh] overflow-hidden lg:h-auto ${m.highlights.has('view3d') ? 'highlight-ring' : ''}`}>
              {(() => {
                const flat = <OrbitPlane2D meta={meta} history={h} version={m.version} truthVisible={m.truthVisible} k2={chi2Table.get(confidence, 2) || 9.21} />;
                return gl ? (
                  <ErrorBoundary fallback={flat}>
                    <OrbitView meta={meta} history={h} version={m.version} truthVisible={m.truthVisible} k3={Number.isFinite(k3) ? k3 : 3.37}
                      confidence={confidence} predicted={predicted} particles={particles} follow={follow} reducedMotion={reduced} onMagnification={setMag} />
                  </ErrorBoundary>
                ) : flat;
              })()}
              <div className="pointer-events-none absolute left-2 top-2 space-y-1 text-[11px]">
                <div className="pointer-events-auto flex flex-wrap gap-1">
                  {m.truthVisible && <span className="chip"><span className="h-2 w-2 rounded-full bg-signal-teal" />truth</span>}
                  <span className="chip"><span className="h-2 w-2 rounded-full bg-signal-amber" />estimate · {meta.estimator.name}</span>
                  <span className="chip">ellipsoid: joint {Math.round(confidence * 100)}% (k = {fmt(k3)}){mag > 1 ? ` · magnified ×${fmt(mag)}` : ''}</span>
                  {particles && <span className="chip text-violet-300">particles (offsets ×{fmt(mag)})</span>}
                  <button className="chip pointer-events-auto hover:text-white" onClick={() => setFollow(!follow)} aria-pressed={follow}>{follow ? '◎ following' : '◎ follow spacecraft'}</button>
                </div>
              </div>
              {k >= 0 && (
                <dl className="absolute bottom-2 right-2 grid grid-cols-2 gap-x-3 rounded-lg border border-white/10 bg-space-950/80 px-3 py-2 text-[11px]">
                  <dt className="text-slate-400">1σ position</dt><dd className="text-right font-mono text-slate-100">{fmtDistance(Math.hypot(h.sigma[0][k], h.sigma[1][k], h.sigma[2][k]))}</dd>
                  <dt className="text-slate-400">along-track σ</dt><dd className="text-right font-mono text-slate-100">{fmtDistance(h.sigmaRtn[1][k])}</dd>
                  {m.truthVisible && <><dt className="text-slate-400">|error|</dt><dd className="text-right font-mono text-slate-100">{fmtDistance(Math.hypot(h.err[0][k], h.err[1][k], h.err[2][k]))}</dd></>}
                  <dt className="text-slate-400">measurements</dt><dd className="text-right font-mono text-slate-100">{m.innovations.t.length}</dd>
                  {h.ess[k] > 0 && <><dt className="text-slate-400">PF ESS</dt><dd className="text-right font-mono text-slate-100">{fmt(h.ess[k])}</dd></>}
                </dl>
              )}
            </div>
            <PlotPanel meta={meta} history={h} innovations={m.innovations} version={m.version} truthVisible={m.truthVisible} confidence={confidence}
              chi2={chi2Table} active={m.activePlot} onActive={m.setActivePlot} highlights={m.highlights} />
          </main>

          <aside className="order-3 lg:min-h-0" aria-label="Mission briefing and assistant">
            {lesson ? (
              <LessonPanel m={m} lesson={lesson} prediction={prediction} botName={content.dialogue.bot.name}
                onPrediction={(id, correct) => {
                  setPrediction(id);
                  m.emit('predictionAnswered', { correct });
                }}
                reasoning={reasoning}
                onReasoning={(id, correct) => {
                  setReasoning(id);
                  m.emit('reasoningAnswered', { correct });
                }}
                onDebrief={openDebrief} />
            ) : (
              <div className="flex h-full flex-col gap-2">
                <div className="panel p-3">
                  <div className="flex items-start gap-3">
                    <BotAvatar mood={m.messages.at(-1)?.mood ?? 'happy'} size={56} />
                    <div className="min-w-0 flex-1" aria-live="polite">
                      <BotBubble name={content.dialogue.bot.name} message={m.messages.at(-1) ?? { id: 0, mood: 'happy', text: content.dialogue.lines['help.playback']?.text ?? 'Sandbox mode: everything is unlocked.' }} />
                    </div>
                  </div>
                </div>
                <div className="panel min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="label mb-1">Scenario</div>
                  <p className="text-sm text-slate-300">{meta.description}</p>
                  <div className="label mb-1 mt-3">Concept cards</div>
                  <ConceptList m={m} />
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {debrief && m.summary && scores && (
        <DebriefModal lesson={lesson} summary={m.summary} scores={scores} success={success} truthWasHidden={truthWasHidden.current}
          prediction={lesson && prediction && prediction !== 'replay' ? (() => {
            const o = lesson.prediction.options.find((x) => x.id === prediction)!;
            return { correct: o.correct, feedback: o.feedback };
          })() : undefined}
          onClose={() => setDebrief(false)} onSave={save}
          onRetry={() => {
            setDebrief(false);
            setReasoning(undefined);
            m.reset();
          }}
          onNext={nextLesson ? () => navigate(`/mission/${nextLesson.id}`) : undefined} />
      )}
      {showdown && <ShowdownPanel scenario={scenario} onRun={() => m.setFlag('showdownRun')} onClose={() => setShowdown(false)} />}
    </div>
  );
}
