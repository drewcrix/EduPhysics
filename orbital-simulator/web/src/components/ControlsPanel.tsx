// Left-hand console: sensors, estimator, process noise, maneuvers and the observability
// diagnostic. Which sections appear is decided by the lesson's `interactive.controls`.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Mission } from '../sim/useMission';
import { SENSOR_STATUS, type SensorMeta } from '../sim/types';
import { fmt } from '../sim/units';
import { CovarianceEditor } from './CovarianceEditor';
import { STATUS_COLORS } from './SensorTimeline';

type Allowed = (c: string) => boolean;

function Section({ id, title, children, highlight, help, onHelp }: { id: string; title: string; children: ReactNode; highlight?: boolean; help?: boolean; onHelp?: () => void }) {
  return (
    <section className={`panel ${highlight ? 'highlight-ring' : ''}`} aria-labelledby={`sec-${id}`}>
      <h2 id={`sec-${id}`} className="panel-title justify-between">
        <span>{title}</span>
        {help && <button className="text-slate-500 hover:text-signal-cyan" onClick={onHelp} aria-label={`Explain ${title}`}>?</button>}
      </h2>
      <div className="space-y-3 px-3 pb-3">{children}</div>
    </section>
  );
}

const sigmas = (C: number[][]) => C.map((r, i) => Math.sqrt(r[i]));

/** Debounced commit so dragging a slider sends one action, not hundreds. */
function useDebounced(fn: (v: number) => void, ms = 350) {
  const t = useRef<ReturnType<typeof setTimeout>>();
  return (v: number) => {
    clearTimeout(t.current);
    t.current = setTimeout(() => fn(v), ms);
  };
}

function SensorCard({ s, idx, m, allowed }: { s: SensorMeta; idx: number; m: Mission; allowed: Allowed }) {
  const trueS = sigmas(s.trueCovariance), assumedS = sigmas(s.assumedCovariance);
  const ratio = assumedS[0] / trueS[0];
  const [r, setR] = useState(ratio);
  const [trueScale, setTrueScale] = useState(1);
  const baseTrue = useRef(trueS);
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setR(assumedS[0] / trueS[0]), [assumedS, trueS]);
  const k = (m.history?.t.length ?? 0) - 1;
  const st = k >= 0 ? SENSOR_STATUS[m.history!.sensorStatus[idx][k]] : 'no-sample';
  const commitAssumed = useDebounced(async (v) => {
    const res = await m.act({ type: 'setSensorAssumedNoise', sensor: s.id, sigma: trueS.map((x) => x * v) });
    setErr(res.ok ? null : res.error ?? null);
  });
  const commitTrue = useDebounced(async (v) => {
    const res = await m.act({ type: 'setSensorTrueNoise', sensor: s.id, sigma: baseTrue.current.map((x) => x * v) });
    setErr(res.ok ? null : res.error ?? null);
  });
  const unit = (i: number) => s.labels[i].unit;
  const show = (v: number[], i = 0) => (s.labels[i].quantity === 'angle' ? `${fmt(v[i] * 1000)} mrad` : `${fmt(v[i])} ${unit(i)}`);
  const nowT = m.status?.t ?? 0;
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={s.enabled} disabled={!allowed('sensors')}
            onChange={(e) => m.act({ type: 'setSensorEnabled', sensor: s.id, enabled: e.target.checked })} />
          <span className="text-sm font-medium text-white">{s.name}</span>
        </label>
        <span className="chip" title={`status at the latest node: ${st}`}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[st] === 'transparent' ? '#334155' : STATUS_COLORS[st] }} />{st}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-400">
        <span className="chip">{s.type}</span>
        {allowed('sensors') ? (
          <select className="chip bg-transparent" value={s.period} aria-label={`${s.name} cadence`}
            onChange={(e) => m.act({ type: 'setSensorPeriod', sensor: s.id, period: Number(e.target.value) })}>
            {[...new Set([s.period, 1, 5, 10, 30, 60, 120, 300])].sort((a, b) => a - b).map((p) => <option key={p} value={p} className="bg-space-900">every {fmt(p)} s</option>)}
          </select>
        ) : <span className="chip">every {fmt(s.period)} s</span>}
        {s.station && <span className="chip">{fmt(s.station.latDeg)}°, {fmt(s.station.lonDeg)}° · mask {s.station.minElevationDeg}°</span>}
        {s.outages.map(([a, b]) => <span key={`${a}`} className="chip text-rose-300">outage {a}–{b} s</span>)}
      </div>
      {s.unsupported && <p className="mt-1 text-[11px] text-violet-300">{s.unsupported}</p>}
      {allowed('noise') && (
        <div className="mt-2">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Assumed σ (filter's R): <b className="text-slate-200">{show(trueS.map((x) => x * r))}</b></span>
            <span>×{fmt(r, 2)} true</span>
          </div>
          <input type="range" className="w-full accent-amber-400" min={-1} max={1} step={0.01} value={Math.log10(r)} aria-label={`${s.name} assumed noise relative to true`}
            onChange={(e) => {
              const v = 10 ** Number(e.target.value);
              setR(v);
              commitAssumed(v);
            }} />
        </div>
      )}
      {allowed('trueNoise') && (
        <div className="mt-1">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>True σ (hardware): <b className="text-slate-200">{show(baseTrue.current.map((x) => x * trueScale))}</b></span>
          </div>
          <input type="range" className="w-full accent-teal-400" min={-0.6} max={0.9} step={0.01} value={Math.log10(trueScale)} aria-label={`${s.name} true noise scale`}
            onChange={(e) => {
              const v = 10 ** Number(e.target.value);
              setTrueScale(v);
              commitTrue(v);
            }} />
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        {allowed('covarianceEditor') && <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setEdit(true)}>Edit R matrix…</button>}
        {allowed('sensors') && <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => m.act({ type: 'setSensorOutages', sensor: s.id, outages: [...s.outages, [Math.ceil(nowT + 1), Math.ceil(nowT + 600)]] })}>+ 10 min outage</button>}
      </div>
      {err && <p className="mt-1 text-[11px] text-rose-300">{err}</p>}
      {edit && (
        <CovarianceEditor title={`Assumed measurement covariance R — ${s.name}`} labels={s.labels} initial={s.assumedCovariance} requirePd
          onApply={(M) => m.act({ type: 'setSensorAssumedNoise', sensor: s.id, covariance: M })} onClose={() => setEdit(false)} />
      )}
    </div>
  );
}

export function ControlsPanel({ m, allowed, onHelp }: { m: Mission; allowed: Allowed; onHelp: (topic: string) => void }) {
  const meta = m.meta!;
  const [est, setEst] = useState(meta.estimator.type);
  const [lin, setLin] = useState<'reference' | 'frozen'>('reference');
  const [particles, setParticles] = useState(500);
  const [qEdit, setQEdit] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Mission-default PSD diagonal; zero entries get a tiny base so presets can still scale them
  const q0vec = useRef(meta.estimator.processNoise.map((r, i) => (r[i] > 0 ? r[i] : 1e-12)));
  const q0 = useRef(Math.max(...q0vec.current));
  const qNow = Math.max(0, ...meta.estimator.processNoise.map((r, i) => r[i]));
  const [dv, setDv] = useState({ r: 0, t: 1, n: 0, inS: 120, known: true });
  const [arc, setArc] = useState({ inS: 60, dur: 300, thrust: 1, r: 0, t: 1, n: 0, tx: 0, ty: 0, tz: 0 });
  const [win, setWin] = useState(300);
  useEffect(() => setEst(meta.estimator.type), [meta.estimator.type]);
  const H = m.highlights;
  const tNow = m.status?.t ?? 0;
  const setQ = (scale: number) => m.act({ type: 'setProcessNoise', psd: q0vec.current.map((v) => v * scale) });
  const rigid = meta.model === 'rigid12';

  return (
    <div className="space-y-2">
      <Section id="sensors" title="Sensors" highlight={H.has('sensors') || H.has('noise')} help onHelp={() => onHelp('sensors')}>
        {meta.sensors.map((s, i) => <SensorCard key={s.id} s={s} idx={i} m={m} allowed={allowed} />)}
      </Section>

      {allowed('estimator') && (
        <Section id="estimator" title="Estimator" highlight={H.has('estimator')} help onHelp={() => onHelp('estimator')}>
          <p className="text-xs text-slate-400">Running: <b className="text-slate-200">{meta.estimator.name}</b></p>
          <select className="field" value={est} onChange={(e) => setEst(e.target.value)} aria-label="Estimator type">
            {meta.estimators.map((e) => <option key={e.type} value={e.type}>{e.name}</option>)}
          </select>
          <p className="text-[11px] text-slate-500">{meta.estimators.find((e) => e.type === est)?.summary}</p>
          {est === 'kf' && meta.model !== 'cw6' && (
            <fieldset className="flex gap-3 text-xs text-slate-300">
              <legend className="label mb-1">Linearisation (not exact for two-body!)</legend>
              {(['reference', 'frozen'] as const).map((v) => (
                <label key={v} className="flex items-center gap-1"><input type="radio" name="lin" checked={lin === v} onChange={() => setLin(v)} />{v === 'reference' ? 'reference trajectory' : 'frozen at t = 0'}</label>
              ))}
            </fieldset>
          )}
          {est === 'pf' && (
            <label className="block text-xs text-slate-300">Particles: {particles}
              <input type="range" className="w-full" min={100} max={3000} step={100} value={particles} onChange={(e) => setParticles(Number(e.target.value))} />
            </label>
          )}
          <button className="btn-primary w-full" onClick={async () => {
            const r = await m.act({ type: 'switchEstimator', estimator: est, ...(est === 'kf' ? { kf: { linearization: lin } } : {}), ...(est === 'pf' ? { pf: { particles } } : {}) });
            setMsg(r.ok ? `Switched at t = ${fmt(tNow)} s; the new filter starts from the current mean and covariance.` : r.error ?? null);
          }}>Switch estimator now</button>
          {msg && <p className="text-[11px] text-slate-400">{msg}</p>}
        </Section>
      )}

      {allowed('processNoise') && (
        <Section id="pn" title="Process noise Q" highlight={H.has('processNoise')} help onHelp={() => onHelp('processNoise')}>
          <p className="text-xs text-slate-400">PSD of unmodelled acceleration: <b className="text-slate-200">{fmt(qNow)} {meta.noiseLabels[0].unit}</b> ({fmt(qNow / q0.current)}× mission default)</p>
          <div className="grid grid-cols-4 gap-1">
            {[[0.01, '×0.01'], [1, 'default'], [100, '×100'], [1e4, '×10⁴']].map(([s, l]) => (
              <button key={String(l)} className="btn-ghost px-1 text-xs" onClick={() => setQ(s as number)}>{l}</button>
            ))}
          </div>
          <input type="range" className="w-full accent-violet-400" min={-3} max={5} step={0.1} value={Math.log10(Math.max(1e-3, qNow / q0.current))} aria-label="Process noise scale (log)"
            onChange={(e) => setQ(10 ** Number(e.target.value))} />
          {allowed('covarianceEditor') && <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setQEdit(true)}>Edit Q matrix…</button>}
          {qEdit && (
            <CovarianceEditor title="Process-noise PSD Q_c" labels={meta.noiseLabels} unitSuffix="" initial={meta.estimator.processNoise} requirePd={false}
              onApply={(M) => m.act({ type: 'setProcessNoise', covariance: M })} onClose={() => setQEdit(false)} />
          )}
        </Section>
      )}

      {allowed('maneuvers') && meta.model !== 'cw6' && (
        <Section id="man" title="Maneuvers" highlight={H.has('maneuvers')} help onHelp={() => onHelp('maneuvers')}>
          <div className="text-[11px] text-slate-400">
            {meta.impulses.filter((i) => i.known || m.truthVisible).map((i) => <div key={i.t + i.label}>• {i.label} at {i.t} s, Δv [{i.dv.map((v) => fmt(v)).join(', ')}] m/s {i.frame}{i.known ? '' : ' (unknown to filter)'}</div>)}
            {meta.segments.map((s) => <div key={s.start + s.label}>• {s.label}: {s.start}–{s.end} s, {s.thrustN} N</div>)}
          </div>
          <fieldset className="space-y-1">
            <legend className="label">Impulsive burn (RTN, m/s)</legend>
            <div className="grid grid-cols-3 gap-1">
              {(['r', 't', 'n'] as const).map((c) => (
                <label key={c} className="text-[11px] text-slate-400">{c.toUpperCase()}
                  <input className="field" type="number" step={0.1} value={dv[c]} onChange={(e) => setDv({ ...dv, [c]: Number(e.target.value) })} /></label>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <label className="flex-1">in [s]<input className="field" type="number" min={1} value={dv.inS} onChange={(e) => setDv({ ...dv, inS: Number(e.target.value) })} /></label>
              <label className="flex items-center gap-1 pt-3"><input type="checkbox" checked={dv.known} onChange={(e) => setDv({ ...dv, known: e.target.checked })} />filter knows</label>
            </div>
            <button className="btn-amber w-full" onClick={async () => {
              const r = await m.act({ type: 'addImpulse', impulse: { t: Math.round(tNow + dv.inS), dv: [dv.r, dv.t, dv.n], frame: 'RTN', known: dv.known, label: 'Operator burn', assumedSigma: [0.02, 0.02, 0.02] } });
              setMsg(r.ok ? null : r.error ?? null);
            }}>Schedule burn</button>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="label">Finite thrust arc</legend>
            <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-400">
              <label>in [s]<input className="field" type="number" value={arc.inS} onChange={(e) => setArc({ ...arc, inS: Number(e.target.value) })} /></label>
              <label>for [s]<input className="field" type="number" value={arc.dur} onChange={(e) => setArc({ ...arc, dur: Number(e.target.value) })} /></label>
              <label>thrust [N]<input className="field" type="number" step={0.1} value={arc.thrust} onChange={(e) => setArc({ ...arc, thrust: Number(e.target.value) })} /></label>
            </div>
            {rigid && (
              <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-400">
                {(['tx', 'ty', 'tz'] as const).map((c) => (
                  <label key={c}>τ{c[1]} [N·m]<input className="field" type="number" step={0.001} value={arc[c]} onChange={(e) => setArc({ ...arc, [c]: Number(e.target.value) })} /></label>
                ))}
              </div>
            )}
            <button className="btn-ghost w-full" onClick={async () => {
              const start = Math.round(tNow + arc.inS);
              const seg = rigid ? { start, end: start + arc.dur, thrustN: arc.thrust, torqueNm: [arc.tx, arc.ty, arc.tz], label: 'Operator thrust arc' }
                                : { start, end: start + arc.dur, thrustN: arc.thrust, frame: 'RTN', direction: [arc.r, arc.t, arc.n], label: 'Operator thrust arc' };
              const r = await m.act({ type: 'addThrustSegment', segment: seg });
              setMsg(r.ok ? null : r.error ?? null);
            }}>Schedule thrust arc{rigid ? ' (body x + torques)' : ' (along-track)'}</button>
          </fieldset>
          {msg && <p className="text-[11px] text-rose-300">{msg}</p>}
        </Section>
      )}

      {allowed('observability') && (
        <Section id="obs" title="Observability check" highlight={H.has('observability')} help onHelp={() => onHelp('observability')}>
          <div className="flex items-end gap-2">
            <label className="flex-1 text-[11px] text-slate-400">Window [s]
              <select className="field" value={win} onChange={(e) => setWin(Number(e.target.value))}>
                {[0, 30, 60, 300, 900, 1800].map((w) => <option key={w} value={w}>{w === 0 ? '0 (one instant)' : w}</option>)}
              </select>
            </label>
            <button className="btn-primary" onClick={() => m.runObservability(win)}>Run</button>
          </div>
          {m.observability?.ok && <ObservabilityResult m={m} />}
          <p className="text-[11px] text-slate-500">Local, linearised test along the <em>estimated</em> trajectory using the enabled sensors and planned controls — not a global guarantee.</p>
        </Section>
      )}
    </div>
  );
}

function ObservabilityResult({ m }: { m: Mission }) {
  const r = m.observability!;
  const meta = m.meta!;
  const full = r.rank === r.stateDim;
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] p-2 text-xs" aria-live="polite">
      <div className={`text-sm font-semibold ${full ? 'text-signal-teal' : 'text-signal-amber'}`}>Rank {r.rank} / {r.stateDim}{full ? ' — locally observable' : ' — rank deficient'}</div>
      <div className="text-slate-400">{r.rows} scalar measurements in {r.window} s · condition {r.condition === null ? '∞' : fmt(r.condition)}</div>
      <table className="mt-1 w-full text-[11px]">
        <thead><tr className="text-slate-500"><th className="text-left">state</th><th className="text-right">best-case σ from this window</th></tr></thead>
        <tbody>
          {meta.stateLabels.map((l, i) => (
            <tr key={l.name} className={r.unobservable[i] ? 'text-rose-300' : 'text-slate-300'}>
              <td>{l.name}</td><td className="text-right font-mono">{r.bestSigma[i] === null ? 'unobservable' : `${fmt(r.bestSigma[i]!)} ${l.unit}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.weakDirections.map((w) => <div key={w} className="mt-1 font-mono text-[11px] text-amber-200">{w}</div>)}
      {r.notes.map((n) => <div key={n} className="mt-1 text-slate-400">{n}</div>)}
    </div>
  );
}
