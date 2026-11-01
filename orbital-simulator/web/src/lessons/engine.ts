// Event/condition rule engine. Lessons respond to what the student does (events) and to
// what the simulation shows (metrics) through declarative rules — no lesson text lives in
// UI components.
import type { Action, Condition, EventName, MetricName, Rule } from './schema';

export interface SimEvent {
  name: EventName;
  data?: Record<string, string | number | boolean>;
}

export type Metrics = Partial<Record<MetricName, number>>;

export interface EvalContext {
  event?: SimEvent;
  metrics: Metrics;
  flags: ReadonlySet<string>;
}

const cmp = (a: number, op: string, b: number) => {
  switch (op) {
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
};

/** Evaluate a condition. Event conditions are true only while that event is dispatched. */
export function evaluate(c: Condition, ctx: EvalContext): boolean {
  if ('all' in c) return c.all.every((x) => evaluate(x, ctx));
  if ('any' in c) return c.any.some((x) => evaluate(x, ctx));
  if ('not' in c) return !evaluate(c.not, ctx);
  if ('flag' in c) return ctx.flags.has(c.flag);
  if ('metric' in c) {
    const v = ctx.metrics[c.metric];
    return v !== undefined && Number.isFinite(v) && cmp(v, c.op, c.value);
  }
  if ('event' in c) {
    if (!ctx.event || ctx.event.name !== c.event) return false;
    for (const [k, expected] of Object.entries(c.where ?? {})) {
      const actual = ctx.event.data?.[k];
      if (typeof expected === 'object') {
        if (typeof actual !== 'number' || !cmp(actual, expected.op, expected.value)) return false;
      } else if (actual !== expected) return false;
    }
    return true;
  }
  return false;
}

/** True if a condition mentions an event (so it can only fire on dispatch). */
export function needsEvent(c: Condition): boolean {
  if ('all' in c) return c.all.some(needsEvent);
  if ('any' in c) return c.any.some(needsEvent);
  if ('not' in c) return needsEvent(c.not);
  return 'event' in c;
}

export type ActionHandler = (action: Action, rule: Rule) => void;

/**
 * Holds a set of rules (global + lesson). `dispatch` evaluates rules against an event;
 * `tick` evaluates metric/flag-only rules against the latest metrics.
 */
export class RuleEngine {
  readonly flags = new Set<string>();
  private fired = new Set<string>();
  private metrics: Metrics = {};

  constructor(private rules: Rule[], private onAction: ActionHandler) {
    const ids = new Set<string>();
    for (const r of rules) {
      if (ids.has(r.id)) throw new Error(`duplicate rule id "${r.id}"`);
      ids.add(r.id);
    }
  }

  dispatch(event: SimEvent) {
    this.run({ event, metrics: this.metrics, flags: this.flags }, true);
  }

  tick(metrics: Metrics) {
    this.metrics = metrics;
    this.run({ metrics, flags: this.flags }, false);
  }

  setFlag(flag: string) {
    this.flags.add(flag);
  }

  hasFired(id: string) {
    return this.fired.has(id);
  }

  reset() {
    this.fired.clear();
    this.flags.clear();
    this.metrics = {};
  }

  private run(ctx: EvalContext, isEvent: boolean) {
    for (const rule of this.rules) {
      if (rule.once && this.fired.has(rule.id)) continue;
      if (!isEvent && needsEvent(rule.when)) continue;
      if (!evaluate(rule.when, ctx)) continue;
      this.fired.add(rule.id);
      for (const a of rule.actions) {
        if (a.type === 'setFlag') this.flags.add(a.flag);
        this.onAction(a, rule);
      }
    }
  }
}

/** Objectives latch: once satisfied they stay satisfied for the run. */
export class ObjectiveTracker {
  private done = new Set<string>();
  constructor(private objectives: { id: string; condition: Condition; required: boolean }[]) {}

  update(ctx: EvalContext): string[] {
    const newly: string[] = [];
    for (const o of this.objectives) {
      if (this.done.has(o.id)) continue;
      if (evaluate(o.condition, ctx)) {
        this.done.add(o.id);
        newly.push(o.id);
      }
    }
    return newly;
  }

  isDone(id: string) {
    return this.done.has(id);
  }

  allRequiredDone() {
    return this.objectives.filter((o) => o.required).every((o) => this.done.has(o.id));
  }

  completed() {
    return [...this.done];
  }

  reset() {
    this.done.clear();
  }
}
