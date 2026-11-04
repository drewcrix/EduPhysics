// Promise-based client for the simulation worker. One client = one worker = one run.
import type { EllipsoidReport, Meta, ObservabilityReport, SimAction, Status, Summary } from './types';

export interface Delta {
  history: Float64Array;
  innovations: Float64Array;
}
export interface StepResult {
  status: Status;
  delta: Delta;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class SimClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev) => {
      const { id, ok, result, error } = ev.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
  }

  /** Requests are serialised so the simulation sees them in a deterministic order. */
  private call<T>(type: string, args: Record<string, unknown> = {}): Promise<T> {
    const run = () =>
      new Promise<T>((resolve, reject) => {
        const id = this.nextId++;
        this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        this.worker.postMessage({ id, type, ...args });
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  init(scenario: unknown) {
    return this.call<{ ok: boolean; meta?: Meta; error?: string }>('init', { scenario });
  }
  step(nodes: number, mode: 0 | 1 | 2 = 0) {
    return this.call<StepResult>('step', { nodes, mode });
  }
  runUntil(t: number) {
    return this.call<StepResult>('runUntil', { t });
  }
  runToEnd() {
    return this.call<StepResult>('runToEnd');
  }
  action(action: SimAction) {
    return this.call<Status & { meta?: Meta; delta: Delta }>('action', { action });
  }
  schedule(log: unknown) {
    return this.call<StepResult>('schedule', { log });
  }
  summary() {
    return this.call<Summary>('summary');
  }
  observability(window: number) {
    return this.call<ObservabilityReport>('observability', { window });
  }
  ellipsoid(k: number, confidence: number) {
    return this.call<EllipsoidReport>('ellipsoid', { k, confidence });
  }
  predict(horizon: number, points: number) {
    return this.call<Float64Array>('predict', { horizon, points });
  }
  particles(max: number) {
    return this.call<Float64Array>('particles', { max });
  }
  actionLog() {
    return this.call<unknown[]>('actionLog');
  }
  hash() {
    return this.call<string>('hash');
  }
  chi2(p: number, k: number) {
    return this.call<number>('chi2', { p, k });
  }
  /** Terminate the worker. Outstanding requests are dropped (never settled) on purpose:
   *  they belong to a view that is going away, so there is nobody left to handle them. */
  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
