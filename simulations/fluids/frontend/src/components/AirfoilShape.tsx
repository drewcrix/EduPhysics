import type { AirfoilInfo } from '../data/types';

/** Outline (true proportions) with the camber line dashed. */
export function AirfoilShape({ airfoil, width = 160, showCamber = true, className = '' }: { airfoil: AirfoilInfo; width?: number; showCamber?: boolean; className?: string }) {
  const pad = 0.04;
  const h = 0.22;
  const sx = (x: number) => ((x + pad) / (1 + 2 * pad)) * width;
  const scale = width / (1 + 2 * pad);
  const height = h * scale;
  const sy = (y: number) => height / 2 - y * scale + 0.02 * scale;
  const path = airfoil.outline.x.map((x, i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(airfoil.outline.y[i]).toFixed(1)}`).join(' ') + 'Z';
  const camber = airfoil.camber_line.x.map((x, i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(airfoil.camber_line.y[i]).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={`${airfoil.name} outline`}>
      <line x1={sx(0)} x2={sx(1)} y1={sy(0)} y2={sy(0)} stroke="#64748b" strokeWidth="0.6" strokeDasharray="2 3" />
      <path d={path} fill="#121f3d" stroke="#fbbf24" strokeWidth="1.2" />
      {showCamber && airfoil.max_camber > 0 && <path d={camber} fill="none" stroke="#38e1ff" strokeWidth="0.9" strokeDasharray="3 2" />}
    </svg>
  );
}
