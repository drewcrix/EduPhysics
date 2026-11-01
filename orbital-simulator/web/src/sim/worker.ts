/// <reference lib="webworker" />
// Web Worker that owns one WebAssembly Simulation. All orbital dynamics, measurement
// generation and estimation run here, in C++, off the UI thread. The UI only receives
// incremental packed history ("deltas") and small JSON reports.
import createOsimModule from '../wasm/generated/osim.mjs';
import wasmUrl from '../wasm/generated/osim.wasm?url';
import type { OsimModule, OsimSimulation } from '../wasm/osim';

let modulePromise: Promise<OsimModule> | null = null;
let sim: OsimSimulation | null = null;
let sentHistory = 0;
let sentInnov = 0;

function getModule(): Promise<OsimModule> {
  modulePromise ??= createOsimModule({ locateFile: () => wasmUrl });
  return modulePromise;
}

function delta() {
  if (!sim) return { history: new Float64Array(0), innovations: new Float64Array(0) };
  const history = sim.history(sentHistory);
  const innovations = sim.innovations(sentInnov);
  sentHistory = sim.historySize();
  sentInnov = sim.innovationSize();
  return { history, innovations };
}

type Req = { id: number; type: string; [k: string]: unknown };

async function handle(req: Req): Promise<{ result: unknown; transfer: Transferable[] }> {
  const M = await getModule();
  const needSim = () => {
    if (!sim) throw new Error('No scenario loaded');
    return sim;
  };
  const withDelta = (statusJson: string) => {
    const d = delta();
    return { result: { status: JSON.parse(statusJson), delta: d }, transfer: [d.history.buffer, d.innovations.buffer] };
  };
  switch (req.type) {
    case 'init': {
      sim?.delete();
      sim = new M.Simulation();
      sentHistory = 0;
      sentInnov = 0;
      const r = JSON.parse(sim.init(JSON.stringify(req.scenario)));
      if (!r.ok) {
        sim.delete();
        sim = null;
        return { result: r, transfer: [] };
      }
      return { result: { ok: true, meta: r.meta }, transfer: [] };
    }
    case 'step':
      return withDelta(needSim().step(req.nodes as number, (req.mode as number) ?? 0));
    case 'runUntil':
      return withDelta(needSim().runUntil(req.t as number));
    case 'runToEnd': {
      const s = needSim();
      let st;
      do st = JSON.parse(s.step(500, 0));
      while (st.ok && !st.finished);
      return withDelta(JSON.stringify(st));
    }
    case 'action': {
      const r = JSON.parse(needSim().action(JSON.stringify(req.action)));
      const d = delta();
      return { result: { ...r, delta: d }, transfer: [d.history.buffer, d.innovations.buffer] };
    }
    case 'schedule':
      return withDelta(needSim().scheduleActions(JSON.stringify(req.log)));
    case 'summary':
      return { result: JSON.parse(needSim().summary()), transfer: [] };
    case 'observability':
      return { result: JSON.parse(needSim().observability(req.window as number)), transfer: [] };
    case 'ellipsoid':
      return { result: JSON.parse(needSim().ellipsoid(req.k as number, req.confidence as number)), transfer: [] };
    case 'predict': {
      const a = needSim().predictTrajectory(req.horizon as number, req.points as number);
      return { result: a, transfer: [a.buffer] };
    }
    case 'particles': {
      const a = needSim().particles(req.max as number);
      return { result: a, transfer: [a.buffer] };
    }
    case 'actionLog':
      return { result: JSON.parse(needSim().actionLog()), transfer: [] };
    case 'hash':
      return { result: needSim().hash(), transfer: [] };
    case 'chi2':
      return { result: M.chi2Quantile(req.p as number, req.k as number), transfer: [] };
    default:
      throw new Error(`unknown request ${req.type}`);
  }
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    const { result, transfer } = await handle(req);
    (self as unknown as Worker).postMessage({ id: req.id, ok: true, result }, transfer);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
