import { useId } from 'react';

/**
 * A slider over a discrete list of values: only computed cases can be selected, nothing in
 * between is interpolated. Tick labels show every available stop.
 */
export function SnapSlider({ label, values, value, onChange, format, help }: {
  label: string;
  values: number[];
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  help?: string;
}) {
  const id = useId();
  const index = Math.max(0, values.indexOf(value));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs font-medium text-slate-300">{label}</label>
        <span className="font-mono text-sm text-slate-100">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={Math.max(0, values.length - 1)}
        step={1}
        value={index}
        disabled={values.length < 2}
        onChange={(e) => onChange(values[Number(e.target.value)])}
        aria-valuetext={format(value)}
        className="mt-2 w-full accent-signal-cyan"
      />
      <div className="mt-0.5 flex justify-between font-mono text-[10px] text-slate-500" aria-hidden="true">
        {values.map((v) => <span key={v} className={v === value ? 'text-signal-cyan' : ''}>{format(v).replace(/[^\d.\-−]/g, '')}</span>)}
      </div>
      {help && <p className="mt-1 text-[11px] leading-snug text-slate-500">{help}</p>}
    </div>
  );
}
