import { describe, expect, it } from 'vitest';
import { ObjectiveTracker, RuleEngine, evaluate } from '../src/lessons/engine';
import { RuleSchema, type Rule } from '../src/lessons/schema';
import { buildContent } from '../src/lessons/content';
import globalRules from '../../content/rules/global.json';

const rule = (r: unknown) => RuleSchema.parse(r) as Rule;

describe('condition evaluation', () => {
  const flags = new Set(['a']);
  it('handles metrics, flags and combinators', () => {
    const m = { t: 100, posSigma: 5 };
    expect(evaluate({ metric: 't', op: '>', value: 50 }, { metrics: m, flags })).toBe(true);
    expect(evaluate({ all: [{ metric: 't', op: '>', value: 50 }, { flag: 'a' }] }, { metrics: m, flags })).toBe(true);
    expect(evaluate({ any: [{ metric: 't', op: '<', value: 50 }, { flag: 'b' }] }, { metrics: m, flags })).toBe(false);
    expect(evaluate({ not: { flag: 'b' } }, { metrics: m, flags })).toBe(true);
    // Missing metrics never satisfy a comparison (e.g. NEES when truth is hidden)
    expect(evaluate({ metric: 'nees', op: '<', value: 1e9 }, { metrics: m, flags })).toBe(false);
  });
  it('matches events with equality and numeric comparisons', () => {
    const ev = { name: 'assumedNoiseChanged' as const, data: { sensor: 'gnss', ratio: 3 } };
    expect(evaluate({ event: 'assumedNoiseChanged', where: { ratio: { op: '>', value: 2 } } }, { event: ev, metrics: {}, flags })).toBe(true);
    expect(evaluate({ event: 'assumedNoiseChanged', where: { sensor: 'other' } }, { event: ev, metrics: {}, flags })).toBe(false);
    expect(evaluate({ event: 'sensorToggled' }, { event: ev, metrics: {}, flags })).toBe(false);
  });
});

describe('rule engine (lesson triggers)', () => {
  it('turning off GNSS triggers the outage explainer once', () => {
    const fired: string[] = [];
    const engine = new RuleEngine((globalRules.rules as unknown[]).map(rule), (a, r) => fired.push(`${r.id}:${a.type}`));
    engine.dispatch({ name: 'sensorToggled', data: { sensor: 'gnss', sensorType: 'gnss_position', enabled: false } });
    expect(fired).toContain('gnss-off:say');
    expect(fired).toContain('gnss-off:concept');
    const n = fired.length;
    engine.dispatch({ name: 'sensorToggled', data: { sensor: 'gnss', sensorType: 'gnss_position', enabled: false } });
    expect(fired.length).toBe(n); // once
  });
  it('selecting range-only opens the observability exercise', () => {
    const fired: string[] = [];
    const engine = new RuleEngine((globalRules.rules as unknown[]).map(rule), (a, r) => fired.push(`${r.id}:${a.type}`));
    engine.dispatch({ name: 'sensorToggled', data: { sensor: 'bravo', sensorType: 'ground_range', enabled: true } });
    expect(fired).toContain('range-only:highlight');
  });
  it('raising assumed R prompts the weighting question; an NIS spike prompts the mismatch lesson', () => {
    const fired: string[] = [];
    const engine = new RuleEngine((globalRules.rules as unknown[]).map(rule), (_a, r) => fired.push(r.id));
    engine.dispatch({ name: 'assumedNoiseChanged', data: { sensor: 'gnss', ratio: 4 } });
    expect(fired).toContain('assumed-r-up');
    engine.tick({ nisMaxRecentNorm: 2 });
    expect(fired).not.toContain('nis-spike');
    engine.tick({ nisMaxRecentNorm: 25 });
    expect(fired).toContain('nis-spike');
  });
  it('metric-only rules do not fire on unrelated events, event rules not on ticks', () => {
    const fired: string[] = [];
    const engine = new RuleEngine(
      [rule({ id: 'e', when: { event: 'simStarted' }, actions: [{ type: 'pause' }] }), rule({ id: 'm', when: { metric: 't', op: '>', value: 5 }, actions: [{ type: 'pause' }] })],
      (_a, r) => fired.push(r.id),
    );
    engine.tick({ t: 1 });
    expect(fired).toEqual([]);
    engine.dispatch({ name: 'simStarted' });
    expect(fired).toEqual(['e']);
    engine.tick({ t: 10 });
    expect(fired).toEqual(['e', 'm']);
  });
  it('setFlag actions feed later flag conditions; duplicate ids are rejected', () => {
    const fired: string[] = [];
    const engine = new RuleEngine(
      [rule({ id: 'a', when: { event: 'simStarted' }, actions: [{ type: 'setFlag', flag: 'go' }] }), rule({ id: 'b', when: { flag: 'go' }, actions: [{ type: 'pause' }] })],
      (_x, r) => fired.push(r.id),
    );
    engine.dispatch({ name: 'simStarted' });
    engine.tick({});
    expect(fired).toEqual(['a', 'b']);
    expect(() => new RuleEngine([rule({ id: 'x', when: { flag: 'f' }, actions: [{ type: 'pause' }] }), rule({ id: 'x', when: { flag: 'f' }, actions: [{ type: 'pause' }] })], () => {})).toThrow();
  });
  it('objectives latch once satisfied', () => {
    const t = new ObjectiveTracker([{ id: 'o', required: true, condition: { metric: 'posSigma', op: '<', value: 10 } }]);
    expect(t.update({ metrics: { posSigma: 50 }, flags: new Set() })).toEqual([]);
    expect(t.update({ metrics: { posSigma: 5 }, flags: new Set() })).toEqual(['o']);
    t.update({ metrics: { posSigma: 50 }, flags: new Set() });
    expect(t.allRequiredDone()).toBe(true);
  });
});

describe('content validation reports authoring mistakes', () => {
  it('flags bad schema, unknown references and missing scenarios', () => {
    const c = buildContent({
      lessons: { 'bad.json': { id: 'Bad Id', title: 'x' } },
      rules: { 'r.json': { rules: [{ id: 'r', when: { event: 'sensorToggled' }, actions: [{ type: 'say', line: 'nope' }] }] } },
      dialogue: { 'd.json': { bot: { name: 'B', tagline: '' }, lines: {}, onboarding: ['missing'], controlHelp: {}, idleTips: [] } },
      concepts: {},
      scenarios: {},
    });
    expect(c.errors.some((e) => e.includes('bad.json'))).toBe(true);
    expect(c.errors.some((e) => e.includes('unknown dialogue line "nope"'))).toBe(true);
    expect(c.errors.some((e) => e.includes('unknown line "missing"'))).toBe(true);
  });
});
