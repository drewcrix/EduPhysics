// The mission session: one simulation worker, its streamed history, deterministic
// playback, and the lesson machinery (rule engine, objectives, bot messages).
//
// Playback design: the requestAnimationFrame loop only decides *how far* to advance
// (sim seconds per real second). The C++ core always steps through the same nodes, so
// results never depend on frame rate or speed; the replay hash proves it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SimClient, type Delta } from './client';
import { appendHistory, appendInnovations, emptyHistory, emptyInnovations, type HistoryColumns, type InnovationColumns } from './layout';
import { computeMetrics, sigmaRatio } from './metrics';
import type { Meta, ObservabilityReport, SimAction, Status, Summary } from './types';
import { ObjectiveTracker, RuleEngine, type Metrics, type SimEvent } from '../lessons/engine';
import type { Action, Concept, Dialogue, Lesson, Rule } from '../lessons/schema';

export type PlotId = 'states' | 'errors' | 'uncertainty' | 'innovations' | 'nis' | 'nees' | 'sensors' | 'controls';

export interface BotMessage {
  id: number;
  text: string;
  mood: 'happy' | 'thinking' | 'alert' | 'celebrate' | 'neutral';
  t?: number;
}

export interface ReplayFile {
  format: 'mission-control-academy/replay';
  version: 1;
  savedAt: string;
  lesson?: string;
  scenario: unknown;
  actions: unknown[];
  hash: string;
  finished: boolean;
}

export interface MissionOptions {
  scenario: Record<string, unknown>;
  lesson?: Lesson;
  globalRules: Rule[];
  dialogue: Dialogue;
  concepts: Concept[];
  truthVisible: boolean;
}

const TRUTH_METRICS: (keyof Metrics)[] = ['posErr', 'nees', 'neesRecentNorm'];

export function useMission(opts: MissionOptions) {
  const clientRef = useRef<SimClient | null>(null);
  const historyRef = useRef<HistoryColumns | null>(null);
  const innovRef = useRef<InnovationColumns | null>(null);
  const metaRef = useRef<Meta | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [pauseAtUpdate, setPauseAtUpdate] = useState(false);
  const [truthVisible, setTruthVisible] = useState(opts.truthVisible);
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [highlights, setHighlights] = useState<Set<string>>(new Set());
  const [activePlot, setActivePlot] = useState<PlotId>('errors');
  const [objectivesDone, setObjectivesDone] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [observability, setObservability] = useState<ObservabilityReport | null>(null);
  const [scenario, setScenario] = useState<Record<string, unknown>>(opts.scenario);
  const [replayCheck, setReplayCheck] = useState<string | null>(null);
  const busy = useRef(false);
  const lastGood = useRef<Record<string, unknown> | null>(null);
  const finishedOnce = useRef(false);
  const target = useRef(0);
  const msgId = useRef(1);
  const initialQ = useRef(1);
  const truthVisibleRef = useRef(truthVisible);
  truthVisibleRef.current = truthVisible;

  const say = useCallback((text: string, mood: BotMessage['mood'] = 'neutral') => {
    setMessages((m) => [...m.slice(-30), { id: msgId.current++, text, mood, t: historyRef.current?.t.at(-1) }]);
  }, []);

  // Rule engine and objectives are rebuilt for each lesson
  const pauseRef = useRef<() => void>(() => {});
  const engine = useMemo(() => {
    const onAction = (a: Action) => {
      switch (a.type) {
        case 'say': {
          const line = a.line ? opts.dialogue.lines[a.line] : undefined;
          say(line?.text ?? a.text ?? '', a.mood ?? line?.mood ?? 'neutral');
          break;
        }
        case 'concept': {
          const c = opts.concepts.find((x) => x.id === a.concept);
          if (c) setConcepts((cs) => (cs.some((x) => x.id === c.id) ? cs : [...cs, c]));
          break;
        }
        case 'highlight':
          setHighlights((h) => new Set(h).add(a.target));
          setTimeout(() => setHighlights((h) => {
            const n = new Set(h);
            n.delete(a.target);
            return n;
          }), 8000);
          break;
        case 'openPlot':
          setActivePlot(a.plot);
          break;
        case 'pause':
          pauseRef.current();
          break;
        case 'setFlag':
          break;
      }
    };
    return new RuleEngine([...opts.globalRules, ...(opts.lesson?.rules ?? [])], onAction);
  }, [opts.globalRules, opts.lesson, opts.dialogue, opts.concepts, say]);
  const objectives = useMemo(() => new ObjectiveTracker(opts.lesson?.objectives ?? []), [opts.lesson]);

  const evalCtx = useCallback((event?: SimEvent) => ({ event, metrics: currentMetrics(), flags: engine.flags }), [engine]);

  function currentMetrics(): Metrics {
    const m = metaRef.current, h = historyRef.current, r = innovRef.current;
    if (!m || !h || !r) return {};
    const out = computeMetrics(m, h, r, statusRef.current?.finished ?? false);
    if (!truthVisibleRef.current) for (const k of TRUTH_METRICS) delete out[k];
    return out;
  }
  const statusRef = useRef<Status | null>(null);

  const emit = useCallback((name: SimEvent['name'], data?: SimEvent['data']) => {
    const ev = { name, data };
    engine.dispatch(ev);
    const newly = objectives.update(evalCtx(ev));
    if (newly.length) setObjectivesDone(objectives.completed());
  }, [engine, objectives, evalCtx]);

  const applyDelta = useCallback((d: Delta, st?: Status) => {
    const m = metaRef.current;
    if (!m || !historyRef.current || !innovRef.current) return;
    appendHistory(m, historyRef.current, d.history);
    appendInnovations(m, innovRef.current, d.innovations);
    if (st) {
      statusRef.current = st;
      setStatus(st);
    }
    const metrics = currentMetrics();
    engine.tick(metrics);
    const newly = objectives.update({ metrics, flags: engine.flags });
    if (newly.length) {
      setObjectivesDone(objectives.completed());
      say(opts.dialogue.lines['lesson.objective']?.text ?? 'Objective complete.', 'happy');
    }
    setVersion((v) => v + 1);
   
  }, [engine, objectives, say, opts.dialogue]);

  const start = useCallback(async (sc: Record<string, unknown>, actions?: unknown[]) => {
    setPlaying(false);
    setError(null);
    setSummary(null);
    setObservability(null);
    setReplayCheck(null);
    clientRef.current ??= new SimClient();
    const client = clientRef.current;
    const r = await client.init(sc);
    if (!r.ok || !r.meta) {
      const msg = r.error ?? 'Could not start the scenario';
      // Keep the console usable: restore the previous valid scenario if there was one
      if (metaRef.current && sc !== lastGood.current && lastGood.current) {
        await start(lastGood.current);
        setError(`Scenario rejected by the core: ${msg} (previous scenario restored)`);
      } else setError(msg);
      return;
    }
    lastGood.current = sc;
    metaRef.current = r.meta;
    historyRef.current = emptyHistory(r.meta);
    innovRef.current = emptyInnovations(r.meta);
    const q = r.meta.estimator.processNoise;
    initialQ.current = Math.max(1e-30, ...q.map((row, i) => row[i]));
    setMeta(r.meta);
    setScenario(sc);
    engine.reset();
    objectives.reset();
    setObjectivesDone([]);
    target.current = 0;
    finishedOnce.current = false;
    // Node 0 (t = 0) is an update phase: process the initial fix so the console has data
    const first = actions ? await client.schedule(actions) : await client.step(1, 2);
    applyDelta(first.delta, first.status);
    if (opts.lesson) emit('lessonStarted', { lesson: opts.lesson.id });
  }, [applyDelta, emit, engine, objectives, opts.lesson]);

  useEffect(() => {
    void start(opts.scenario);
    return () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.scenario, opts.lesson]);

  const finish = useCallback(async () => {
    setPlaying(false);
    const s = await clientRef.current!.summary();
    setSummary(s);
    emit('simFinished');
    applyDelta({ history: new Float64Array(0), innovations: new Float64Array(0) });
  }, [emit, applyDelta]);

  const after = useCallback(async (res: { status: Status; delta: Delta }) => {
    applyDelta(res.delta, res.status);
    if (res.status.finished && !finishedOnce.current) {
      finishedOnce.current = true;
      await finish();
    }
  }, [applyDelta, finish]);

  const stepNode = useCallback(async () => {
    if (!clientRef.current || busy.current) return;
    busy.current = true;
    try {
      const res = await clientRef.current.step(1, 0);
      target.current = res.status.t;
      await after(res);
    } finally {
      busy.current = false;
    }
  }, [after]);

  const stepPhase = useCallback(async (phase: 'predict' | 'update') => {
    if (!clientRef.current || busy.current) return;
    busy.current = true;
    try {
      const res = await clientRef.current.step(1, phase === 'predict' ? 1 : 2);
      target.current = res.status.t;
      await after(res);
      emit('phaseStep', { phase });
    } finally {
      busy.current = false;
    }
  }, [after, emit]);

  pauseRef.current = () => setPlaying(false);

  // Playback loop
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = async (now: number) => {
      const dtReal = Math.min(0.25, (now - last) / 1000);
      last = now;
      const c = clientRef.current;
      if (c && !busy.current && statusRef.current && !statusRef.current.finished) {
        busy.current = true;
        try {
          let res;
          if (pauseAtUpdate) {
            // Advance one prediction, then stop so the student can inspect before the update
            res = await c.step(1, statusRef.current.phase === 'update' ? 2 : 1);
            if (res.status.phase === 'update') setPlaying(false);
          } else {
            target.current = Math.max(target.current, statusRef.current.t) + dtReal * speed;
            res = await c.runUntil(target.current);
          }
          await after(res);
        } catch (e) {
          setError(String(e));
          setPlaying(false);
        } finally {
          busy.current = false;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, pauseAtUpdate, after]);

  const play = useCallback(() => {
    if (statusRef.current?.finished) return;
    setPlaying(true);
    emit('simStarted');
  }, [emit]);
  const pause = useCallback(() => setPlaying(false), []);
  const reset = useCallback(() => {
    emit('reset');
    void start(scenario);
  }, [emit, scenario, start]);

  /** Apply a live action and dispatch the matching lesson event. */
  const act = useCallback(async (action: SimAction) => {
    const c = clientRef.current, m = metaRef.current;
    if (!c || !m) return { ok: false, error: 'not ready' };
    const r = await c.action(action);
    if (!r.ok) return { ok: false, error: r.error };
    if (r.meta) {
      metaRef.current = r.meta;
      setMeta(r.meta);
    }
    applyDelta(r.delta);
    const sensor = 'sensor' in action ? r.meta?.sensors.find((s) => s.id === action.sensor) : undefined;
    switch (action.type) {
      case 'setSensorEnabled':
        emit('sensorToggled', { sensor: action.sensor, sensorType: sensor?.type ?? '', enabled: action.enabled });
        break;
      case 'setSensorAssumedNoise':
        if (sensor) emit('assumedNoiseChanged', { sensor: sensor.id, sensorType: sensor.type, ratio: sigmaRatio(sensor.assumedCovariance, sensor.trueCovariance) });
        break;
      case 'setSensorTrueNoise':
        if (sensor) emit('trueNoiseChanged', { sensor: sensor.id, ratio: sigmaRatio(sensor.assumedCovariance, sensor.trueCovariance) });
        break;
      case 'setProcessNoise': {
        const q = r.meta?.estimator.processNoise ?? [];
        const qmax = Math.max(0, ...q.map((row, i) => row[i]));
        emit('processNoiseChanged', { scale: qmax / initialQ.current });
        break;
      }
      case 'switchEstimator':
        emit('estimatorChanged', { estimator: action.estimator });
        break;
      case 'addImpulse':
        emit('maneuverScheduled', { known: action.impulse.known ?? true, kind: 'impulse' });
        break;
      case 'addThrustSegment':
        emit('maneuverScheduled', { known: true, kind: 'finite' });
        break;
    }
    return { ok: true };
  }, [applyDelta, emit]);

  const runObservability = useCallback(async (window: number) => {
    const c = clientRef.current;
    if (!c) return;
    const rep = await c.observability(window);
    setObservability(rep);
    if (rep.ok) emit('observabilityRun', { rank: rep.rank, stateDim: rep.stateDim, deficient: rep.rank < rep.stateDim });
  }, [emit]);

  const saveReplay = useCallback(async (): Promise<ReplayFile | null> => {
    const c = clientRef.current;
    if (!c) return null;
    const [actions, hash] = await Promise.all([c.actionLog(), c.hash()]);
    return { format: 'mission-control-academy/replay', version: 1, savedAt: new Date().toISOString(), lesson: opts.lesson?.id, scenario, actions, hash, finished: statusRef.current?.finished ?? false };
  }, [opts.lesson, scenario]);

  const loadReplay = useCallback(async (file: ReplayFile) => {
    if (file.format !== 'mission-control-academy/replay') throw new Error('Not a Mission Control Academy replay file.');
    await start(file.scenario as Record<string, unknown>, file.actions);
    const c = clientRef.current!;
    if (file.finished) {
      const res = await c.runToEnd();
      await after(res);
      const h = await c.hash();
      setReplayCheck(h === file.hash ? `Replay verified: hash ${h} matches the saved run.` : `Replay differs: saved ${file.hash}, now ${h}. (Different build or platform?)`);
    } else {
      setReplayCheck('Replay loaded up to the saved actions; press Play to continue.');
    }
  }, [start, after]);

  /** Set a lesson flag from the UI (e.g. "showdownRun") and re-evaluate objectives now. */
  const setFlag = useCallback((flag: string) => {
    engine.setFlag(flag);
    const metrics = currentMetrics();
    engine.tick(metrics);
    if (objectives.update({ metrics, flags: engine.flags }).length) setObjectivesDone(objectives.completed());
   
  }, [engine, objectives]);

  const toggleTruth = useCallback((v: boolean) => {
    setTruthVisible(v);
    emit('truthToggled', { visible: v });
  }, [emit]);

  return {
    client: clientRef, meta, status, error, version,
    history: historyRef.current, innovations: innovRef.current,
    playing, play, pause, stepNode, stepPhase, reset, speed, setSpeed, pauseAtUpdate, setPauseAtUpdate,
    truthVisible, setTruthVisible: toggleTruth,
    messages, say, concepts, dismissConcept: (id: string) => setConcepts((cs) => cs.filter((c) => c.id !== id)),
    highlights, activePlot, setActivePlot, objectivesDone,
    act, emit, engine, setFlag, summary, observability, runObservability, scenario, start, saveReplay, loadReplay, replayCheck,
    currentMetrics,
  };
}

export type Mission = ReturnType<typeof useMission>;
