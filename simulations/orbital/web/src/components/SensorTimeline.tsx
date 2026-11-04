// Sensor availability strip: one row per sensor, coloured by status at each node.
import { useEffect, useRef } from 'react';
import type { HistoryColumns } from '../sim/layout';
import { SENSOR_STATUS, type Meta } from '../sim/types';

export const STATUS_COLORS: Record<string, string> = {
  'no-sample': 'transparent', used: '#2dd4bf', disabled: '#475569', outage: '#fb7185', 'not-visible': '#1e3a8a', unsupported: '#a78bfa', failed: '#f97316',
};

export function SensorTimeline({ meta, history, version }: { meta: Meta; history: HistoryColumns; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const rowH = 18;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = c.clientWidth, hgt = rowH * meta.sensors.length;
    c.width = w * devicePixelRatio;
    c.height = hgt * devicePixelRatio;
    const g = c.getContext('2d')!;
    g.scale(devicePixelRatio, devicePixelRatio);
    g.clearRect(0, 0, w, hgt);
    const T = meta.duration;
    meta.sensors.forEach((_, s) => {
      g.fillStyle = 'rgba(148,163,184,0.06)';
      g.fillRect(0, s * rowH + 2, w, rowH - 4);
      const st = history.sensorStatus[s];
      for (let k = 0; k < history.t.length; k++) {
        const name = SENSOR_STATUS[st[k]];
        if (name === 'no-sample') continue;
        g.fillStyle = STATUS_COLORS[name];
        const x = (history.t[k] / T) * w;
        g.fillRect(x, s * rowH + 3, Math.max(1.5, w / Math.max(400, T / meta.dt)), rowH - 6);
      }
    });
  }, [meta, history, version]);
  return (
    <div>
      <div className="flex gap-3">
        <div className="flex shrink-0 flex-col text-[11px] text-slate-300">
          {meta.sensors.map((s) => <div key={s.id} style={{ height: rowH }} className="flex items-center">{s.name}</div>)}
        </div>
        <canvas ref={ref} className="w-full" style={{ height: rowH * meta.sensors.length }} role="img"
          aria-label="Sensor availability over the mission: green used, red outage, grey disabled, blue below horizon, violet unsupported" />
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
        {Object.entries(STATUS_COLORS).filter(([k]) => k !== 'no-sample').map(([k, c]) => (
          <span key={k} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{k}</span>
        ))}
      </div>
    </div>
  );
}
