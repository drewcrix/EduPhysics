import type { FlowClass } from '../data/types';

export const flowClassInfo: Record<FlowClass, { label: string; tone: string; help: string }> = {
  steady: { label: 'Steady', tone: 'border-signal-teal/40 bg-signal-teal/10 text-signal-teal', help: 'Converged to a steady state (residual below 1e-4 and forces constant).' },
  nearly_steady: { label: 'Nearly steady', tone: 'border-signal-teal/30 bg-signal-teal/5 text-teal-200', help: 'Forces changed by less than 0.001 over the last 12 time units, but the strict residual criterion was not reached.' },
  periodic: { label: 'Periodic shedding', tone: 'border-signal-amber/40 bg-signal-amber/10 text-signal-amber', help: 'Unsteady with one dominant frequency (vortex shedding). Coefficients are time averages; the band shows the min–max range.' },
  irregular: { label: 'Unsteady, irregular', tone: 'border-signal-rose/40 bg-signal-rose/10 text-signal-rose', help: 'Unsteady without a single dominant frequency. Coefficients are time averages over the last 12 time units.' },
  not_converged: { label: 'Not converged', tone: 'border-slate-400/40 bg-slate-400/10 text-slate-300', help: 'Still drifting at the end of the run: the reported means are not final values. A longer simulation is needed.' },
};

export function FlowBadge({ kind }: { kind: FlowClass }) {
  const info = flowClassInfo[kind];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${info.tone}`} title={info.help}>{info.label}</span>;
}

export function SourceTag({ kind }: { kind: 'cfd' | 'theory' | 'concept' | 'empirical' }) {
  const styles = {
    cfd: ['Navier–Stokes CFD', 'border-signal-cyan/40 text-signal-cyan'],
    theory: ['Analytical theory', 'border-signal-violet/40 text-signal-violet'],
    concept: ['Conceptual illustration — not computed', 'border-signal-rose/40 text-signal-rose'],
    empirical: ['Empirical (published data)', 'border-signal-lime/40 text-signal-lime'],
  } as const;
  const [label, tone] = styles[kind];
  return <span className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${tone}`}>{label}</span>;
}
