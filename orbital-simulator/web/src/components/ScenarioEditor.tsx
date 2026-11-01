// Sandbox scenario editing: ground-station placement and the full scenario JSON.
// Edits restart the run from t = 0; the C++ core validates everything and the previous
// scenario is restored if it rejects the new one.
import { useState } from 'react';

type Scenario = Record<string, unknown>;
interface SensorJson { id: string; type: string; name?: string; station?: { name?: string; latDeg: number; lonDeg: number; altM?: number }; minElevationDeg?: number }

export function ScenarioEditor({ scenario, onApply }: { scenario: Scenario; onApply: (s: Scenario) => void }) {
  const [open, setOpen] = useState<'none' | 'stations' | 'json'>('none');
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const sensors = (scenario.sensors as SensorJson[]) ?? [];
  const ground = sensors.filter((s) => s.station);
  const [sites, setSites] = useState(() => Object.fromEntries(ground.map((s) => [s.id, { lat: s.station!.latDeg, lon: s.station!.lonDeg, mask: s.minElevationDeg ?? 10 }])));

  const applyStations = () => {
    const next = structuredClone(scenario);
    for (const s of next.sensors as SensorJson[]) {
      const v = sites[s.id];
      if (!v || !s.station) continue;
      if (Math.abs(v.lat) > 90 || Math.abs(v.lon) > 180 || v.mask < 0 || v.mask >= 90) {
        setErr(`${s.name ?? s.id}: latitude must be within ±90°, longitude ±180°, mask 0–90°.`);
        return;
      }
      s.station.latDeg = v.lat;
      s.station.lonDeg = v.lon;
      s.minElevationDeg = v.mask;
    }
    setErr(null);
    onApply(next);
  };

  return (
    <section className="panel p-3 text-xs text-slate-300" aria-label="Scenario editor">
      <div className="label mb-1">Scenario editor</div>
      <div className="flex gap-1">
        {ground.length > 0 && <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setOpen(open === 'stations' ? 'none' : 'stations')} aria-expanded={open === 'stations'}>Ground stations</button>}
        <button className="btn-ghost px-2 py-0.5 text-[11px]" onClick={() => {
          setText(JSON.stringify(scenario, null, 2));
          setOpen(open === 'json' ? 'none' : 'json');
        }} aria-expanded={open === 'json'}>Edit JSON</button>
      </div>
      {open === 'stations' && (
        <div className="mt-2 space-y-2">
          {ground.map((s) => (
            <fieldset key={s.id} className="grid grid-cols-3 gap-1">
              <legend className="col-span-3 text-[11px] text-slate-400">{s.name ?? s.id} ({s.type === 'ground_range' ? 'range only' : 'range + bearing'})</legend>
              {(['lat', 'lon', 'mask'] as const).map((k) => (
                <label key={k} className="text-[10px] text-slate-500">{k === 'mask' ? 'mask [°]' : `${k} [°]`}
                  <input className="field" type="number" step={0.5} value={sites[s.id][k]} onChange={(e) => setSites({ ...sites, [s.id]: { ...sites[s.id], [k]: Number(e.target.value) } })} />
                </label>
              ))}
            </fieldset>
          ))}
          <button className="btn-primary w-full" onClick={applyStations}>Apply & restart</button>
        </div>
      )}
      {open === 'json' && (
        <div className="mt-2">
          <textarea className="field h-64 font-mono text-[11px]" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} aria-label="Scenario JSON" />
          <p className="text-[10px] text-slate-500">Schema: docs/ARCHITECTURE.md → "Scenario schema". SI units throughout.</p>
          <button className="btn-primary mt-1 w-full" onClick={() => {
            try {
              const next = JSON.parse(text) as Scenario;
              setErr(null);
              onApply(next);
            } catch (e) {
              setErr(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}>Apply & restart</button>
        </div>
      )}
      {err && <p className="mt-1 text-rose-300" role="alert">{err}</p>}
    </section>
  );
}
