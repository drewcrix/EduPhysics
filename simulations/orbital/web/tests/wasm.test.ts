// Runs the real WebAssembly module under Node: layout decoding, deterministic replay and
// playback-speed independence through the same API the browser worker uses.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appendHistory, appendInnovations, emptyHistory, emptyInnovations } from '../src/sim/layout';
import type { Meta } from '../src/sim/types';
import type { OsimModule } from '../src/wasm/osim';

const modUrl = new URL('../src/wasm/generated/osim.mjs', import.meta.url);
const scenario = (id: string) => readFileSync(fileURLToPath(new URL(`../../scenarios/${id}.json`, import.meta.url)), 'utf8');

async function load(): Promise<OsimModule> {
  const create = (await import(/* @vite-ignore */ modUrl.href)).default;
  return create();
}

describe('WebAssembly core', async () => {
  const M = await load();

  it('initialises, runs and streams records that decode with meta.layout', () => {
    const sim = new M.Simulation();
    const init = JSON.parse(sim.init(scenario('first_fix')));
    expect(init.ok).toBe(true);
    const meta = init.meta as Meta;
    const h = emptyHistory(meta);
    const r = emptyInnovations(meta);
    let sentH = 0, sentI = 0;
    for (let i = 0; i < 20; i++) {
      sim.step(17, 0);
      appendHistory(meta, h, sim.history(sentH));
      appendInnovations(meta, r, sim.innovations(sentI));
      sentH = sim.historySize();
      sentI = sim.innovationSize();
    }
    expect(h.t.length).toBe(sentH);
    expect(h.t.every((t, i) => i === 0 || t > h.t[i - 1])).toBe(true);
    expect(r.nis.length).toBe(sentI);
    expect(h.sensorStatus[0][0]).toBe(1); // first GNSS fix used at t = 0
    sim.delete();
  });

  it('reports invalid scenarios as errors instead of throwing', () => {
    const sim = new M.Simulation();
    const bad = JSON.parse(scenario('first_fix'));
    bad.estimator.type = 'magic';
    const r = JSON.parse(sim.init(JSON.stringify(bad)));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unknown estimator/);
    expect(JSON.parse(sim.step(1, 0)).ok).toBe(false);
    sim.delete();
  });

  it('replays an interactive session bit-for-bit and is independent of playback chunking', () => {
    const live = new M.Simulation();
    live.init(scenario('planned_burn'));
    live.step(30, 0);
    live.action(JSON.stringify({ type: 'setSensorEnabled', sensor: 'gnss', enabled: false }));
    live.step(25, 0);
    live.action(JSON.stringify({ type: 'setSensorEnabled', sensor: 'gnss', enabled: true }));
    live.step(1, 1); // predict only (paused between phases)
    live.action(JSON.stringify({ type: 'setProcessNoise', psd: [1e-9, 1e-9, 1e-9] }));
    let st;
    do st = JSON.parse(live.runUntil(1e9)); while (!st.finished);
    const log = live.actionLog();

    const replay = new M.Simulation();
    replay.init(scenario('planned_burn'));
    replay.scheduleActions(log);
    do st = JSON.parse(replay.step(1000, 0)); while (!st.finished);
    expect(replay.hash()).toBe(live.hash());

    // Same scenario without actions: any chunking gives the same hash
    const a = new M.Simulation(), b = new M.Simulation();
    a.init(scenario('first_fix'));
    b.init(scenario('first_fix'));
    do st = JSON.parse(a.step(1, 0)); while (!st.finished);
    for (let t = 0; !st.finished || t === 0; t += 333) st = JSON.parse(b.runUntil(t));
    expect(a.hash()).toBe(b.hash());
    [live, replay, a, b].forEach((s) => s.delete());
  });

  it('exposes diagnostics: observability, ellipsoid and chi-square', () => {
    const sim = new M.Simulation();
    sim.init(scenario('first_fix'));
    sim.step(5, 0);
    const obs = JSON.parse(sim.observability(60));
    expect(obs.rank).toBe(6);
    const e = JSON.parse(sim.ellipsoid(3, 0.99));
    expect(e.k2).toBeCloseTo(11.3449, 3);
    expect(e.semiAxes[0]).toBeGreaterThanOrEqual(e.semiAxes[2]);
    expect(M.chi2Quantile(0.99, 1)).toBeCloseTo(6.6349, 3);
    expect(JSON.parse(M.listEstimators()).map((x: { type: string }) => x.type).sort()).toEqual(['ekf', 'kf', 'pf', 'ukf']);
    sim.delete();
  });
});
