// Thin React wrapper around uPlot (fast canvas time-series plots).
import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

export interface Series {
  label: string;
  color: string;
  values: (number | null)[];
  dash?: number[];
  width?: number;
  points?: boolean; // scatter (no connecting line)
  fill?: string;
}

export interface ChartProps {
  title: string;
  x: number[];
  series: Series[];
  yLabel: string;
  height?: number;
  logY?: boolean;
  bands?: [number, number, string][]; // fill between series indices (1-based, upper, lower)
  xLabel?: string;
}

const axisStyle = { stroke: '#94a3b8', grid: { stroke: 'rgba(148,163,184,0.08)' }, ticks: { stroke: 'rgba(148,163,184,0.15)' } };

export function Chart({ title, x, series, yLabel, height = 170, logY = false, bands, xLabel = 't [s]' }: ChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const shape = `${series.map((s) => s.label + s.color + (s.points ? 'p' : '')).join('|')}|${logY}|${yLabel}|${title}|${JSON.stringify(bands ?? [])}`;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const opts: uPlot.Options = {
      title,
      width: Math.max(200, el.clientWidth),
      height,
      scales: { x: { time: false }, y: logY ? { distr: 3 } : {} },
      axes: [{ ...axisStyle, label: xLabel, labelSize: 14, size: 32 }, { ...axisStyle, label: yLabel, labelSize: 16, size: 58 }],
      legend: { show: true, live: true },
      cursor: { drag: { x: true, y: false } },
      bands: bands?.map(([a, b, fill]) => ({ series: [a, b] as [number, number], fill })),
      series: [
        { label: 't' },
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: s.width ?? 1.5,
          dash: s.dash,
          fill: s.fill,
          spanGaps: !s.points,
          points: s.points ? { show: true, size: 4, fill: s.color, stroke: s.color } : { show: false },
          paths: s.points ? () => null : undefined,
        })),
      ],
    };
    plot.current = new uPlot(opts, [x, ...series.map((s) => s.values)] as uPlot.AlignedData, el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: Math.max(200, el.clientWidth), height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, height]);

  useEffect(() => {
    plot.current?.setData([x, ...series.map((s) => s.values)] as uPlot.AlignedData);
  });

  return <div ref={host} className="w-full" role="img" aria-label={`${title} chart`} />;
}
