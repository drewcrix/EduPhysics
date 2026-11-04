import { Logo } from '@eduphysics/ui';
import { simulators, type Simulator } from './catalog';

const accents: Record<Simulator['accent'], string> = {
  cyan: 'from-signal-cyan/25 text-signal-cyan border-signal-cyan/30',
  amber: 'from-signal-amber/25 text-signal-amber border-signal-amber/30',
  teal: 'from-signal-teal/25 text-signal-teal border-signal-teal/30',
  violet: 'from-signal-violet/25 text-signal-violet border-signal-violet/30',
};

/** Small animated previews (pure SVG, no data). */
function Preview({ id }: { id: string }) {
  if (id === 'orbital') {
    return (
      <svg viewBox="0 0 320 150" className="h-full w-full" aria-hidden="true">
        <defs>
          <radialGradient id="pv-earth" cx="35%" cy="35%" r="70%"><stop offset="0%" stopColor="#1e4fa8" /><stop offset="100%" stopColor="#06132e" /></radialGradient>
          <path id="pv-orbit" d="M 50 75 A 110 45 -12 1 1 270 75 A 110 45 -12 1 1 50 75" />
        </defs>
        <circle cx="160" cy="75" r="34" fill="url(#pv-earth)" stroke="#38e1ff" strokeOpacity="0.35" />
        <use href="#pv-orbit" fill="none" stroke="#2dd4bf" strokeOpacity="0.5" strokeWidth="1.4" />
        <circle r="3.5" fill="#2dd4bf"><animateMotion dur="10s" repeatCount="indefinite"><mpath href="#pv-orbit" /></animateMotion></circle>
        <g>
          <ellipse rx="10" ry="5" fill="#fbbf24" fillOpacity="0.18" stroke="#fbbf24" strokeOpacity="0.6" />
          <circle r="2.5" fill="#fbbf24" />
          <animateMotion dur="10s" begin="-0.3s" repeatCount="indefinite" rotate="auto"><mpath href="#pv-orbit" /></animateMotion>
        </g>
      </svg>
    );
  }
  // Airfoil with schematic streamlines (decorative only)
  const lines = [-48, -32, -18, -6, 6, 18, 32, 48];
  return (
    <svg viewBox="0 0 320 150" className="h-full w-full" aria-hidden="true">
      {lines.map((y, i) => {
        const bump = y < 0 ? -14 * Math.exp(-((y + 4) ** 2) / 500) : 9 * Math.exp(-((y - 4) ** 2) / 500);
        return (
          <path key={y} d={`M 0 ${75 + y} C 90 ${75 + y}, 120 ${75 + y + bump}, 165 ${75 + y + bump} S 250 ${75 + y + 3}, 320 ${75 + y + 4}`}
            fill="none" stroke="#38e1ff" strokeOpacity={0.25 + 0.06 * (i % 3)} strokeWidth="1.2" strokeDasharray="10 8">
            <animate attributeName="stroke-dashoffset" from="36" to="0" dur={`${1.6 + 0.15 * (i % 4)}s`} repeatCount="indefinite" />
          </path>
        );
      })}
      <path d="M 95 78 C 100 66, 135 60, 175 64 C 205 67, 230 74, 245 82 C 220 83, 160 84, 120 84 C 104 84, 96 82, 95 78 Z"
        fill="#0e1830" stroke="#fbbf24" strokeWidth="1.6" transform="rotate(-6 170 75)" />
    </svg>
  );
}

function SimulatorCard({ sim }: { sim: Simulator }) {
  const accent = accents[sim.accent];
  return (
    <article className="panel group flex flex-col overflow-hidden transition hover:border-white/20">
      <div className={`relative h-40 border-b border-white/10 bg-gradient-to-br ${accent.split(' ')[0]} to-transparent`}>
        <Preview id={sim.id} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${accent.split(' ')[1]}`}>{sim.subject}</p>
          <h3 className="mt-1 font-display text-2xl font-semibold text-slate-100">{sim.title}</h3>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{sim.summary}</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Topics">
          {sim.topics.map((t) => <li key={t} className="chip">{t}</li>)}
        </ul>
        <p className="text-xs leading-relaxed text-slate-400"><span className="font-semibold text-slate-300">Under the hood: </span>{sim.engine}</p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-xs text-slate-500">{sim.level}</span>
          <a href={sim.href} className="btn-primary" aria-label={`Open ${sim.title}`}>Open simulator →</a>
        </div>
      </div>
    </article>
  );
}

export function App() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo size={28} />
          <span className="font-display text-lg font-semibold tracking-[0.22em] text-slate-100">EDUPHYSICS</span>
        </div>
        <a className="text-sm text-slate-400 hover:text-slate-200" href="#how-it-works">How it works</a>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <section className="py-10 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-signal-teal">Interactive physics for engineers</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight text-white sm:text-5xl">
            Learn the physics by running the models engineers actually use.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-300">
            Each simulator utilizes classic numerical models and explains the theory behind them for an interactive learning environment. Pick a course to start!
          </p>
        </section>

        <section aria-labelledby="simulators-heading">
          <div className="mb-4 flex items-end justify-between">
            <h2 id="simulators-heading" className="font-display text-xl font-semibold text-slate-100">Simulators</h2>
            <span className="text-xs text-slate-500">{simulators.filter((s) => s.status === 'available').length} available</span>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {simulators.map((s) => <SimulatorCard key={s.id} sim={s} />)}
          </div>
          <div className="mt-6 rounded-xl border border-dashed border-white/15 p-5 text-sm text-slate-400">
            <span className="font-semibold text-slate-300">More courses are on the way.</span> The catalogue is built
            to grow. The next simulator will be a <span className="font-semibold text-slate-300">music synthesizer</span> where students will learn all about Fourier transforms and their application to music generation.
          </div>
        </section>

        <section id="how-it-works" className="mt-16 grid gap-6 md:grid-cols-3" aria-labelledby="how-heading">
          <h2 id="how-heading" className="sr-only">How it works</h2>
          {[
            ['Real models', 'Orbital mechanics and estimation run as compiled C++ in your browser; airfoil flows are solutions of the Navier–Stokes equations computed in advance.'],
            ['Theory alongside', 'Equations, assumptions and limits sit next to the controls they explain, from first principles to optional advanced notes.'],
            ['Honest results', 'Every number is labelled for what it is: simulation, analytical theory or a conceptual sketch. Configurations a model cannot handle are not offered.'],
          ].map(([title, body]) => (
            <div key={title} className="panel p-5">
              <h3 className="font-display text-base font-semibold text-slate-100">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-white/10 py-6 text-center text-xs text-slate-500">
        EduPhysics · open educational simulators
      </footer>
    </div>
  );
}
