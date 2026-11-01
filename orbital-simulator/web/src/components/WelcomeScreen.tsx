import { useEffect, useState } from 'react';
import type { Content } from '../lessons/content';
import { isUnlocked, type Progress } from '../lessons/progress';
import { BotAvatar, BotBubble } from './Bot';
import { navigate } from '../App';

/** Animated SVG preview of an orbit with a filter estimate chasing truth. */
function OrbitPreview() {
  const stars = Array.from({ length: 40 }, (_, i) => ({ x: (i * 97) % 400, y: (i * 53) % 260, d: (i % 7) * 0.4 }));
  return (
    <svg viewBox="0 0 400 260" className="h-full w-full" role="img" aria-label="Preview: a spacecraft orbiting Earth, with its estimated position and uncertainty ellipse following the true orbit">
      {stars.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={i % 5 ? 0.7 : 1.2} fill="#cbd5e1" className="anim-twinkle" style={{ animationDelay: `${s.d}s` }} />)}
      <defs>
        <radialGradient id="earth" cx="35%" cy="35%" r="70%"><stop offset="0%" stopColor="#1e4fa8" /><stop offset="70%" stopColor="#0b2559" /><stop offset="100%" stopColor="#06132e" /></radialGradient>
        <path id="orbit-path" d="M 60 130 A 140 62 -18 1 1 340 130 A 140 62 -18 1 1 60 130" />
      </defs>
      <circle cx="200" cy="130" r="58" fill="url(#earth)" stroke="#38e1ff" strokeOpacity="0.35" />
      {[-30, 0, 30].map((a) => <ellipse key={a} cx="200" cy="130" rx="58" ry={58 * Math.cos((a * Math.PI) / 180) * 0.35 + 6} fill="none" stroke="#38e1ff" strokeOpacity="0.12" transform={`translate(0 ${a * 0.9})`} />)}
      <g className="anim-spin"><ellipse cx="200" cy="130" rx="22" ry="58" fill="none" stroke="#38e1ff" strokeOpacity="0.15" /></g>
      <use href="#orbit-path" fill="none" stroke="#2dd4bf" strokeOpacity="0.55" strokeWidth="1.5" />
      <use href="#orbit-path" fill="none" stroke="#fbbf24" strokeOpacity="0.7" strokeWidth="1.5" strokeDasharray="6 8" className="anim-orbit" />
      <g>
        <circle r="4" fill="#2dd4bf"><animateMotion dur="12s" repeatCount="indefinite"><mpath href="#orbit-path" /></animateMotion></circle>
        <g>
          <ellipse rx="12" ry="6" fill="#fbbf24" fillOpacity="0.18" stroke="#fbbf24" strokeOpacity="0.6" />
          <circle r="3" fill="#fbbf24" />
          <animateMotion dur="12s" begin="-0.25s" repeatCount="indefinite" rotate="auto"><mpath href="#orbit-path" /></animateMotion>
        </g>
      </g>
      <text x="16" y="246" fill="#94a3b8" fontSize="10">teal: truth · amber: estimate with uncertainty</text>
    </svg>
  );
}

export function WelcomeScreen({ content, progress }: { content: Content; progress: Progress }) {
  const { dialogue, lessons } = content;
  const returning = Object.keys(progress).length > 0;
  const steps = returning ? ['welcome.back', ...dialogue.onboarding.slice(1)] : dialogue.onboarding;
  const [i, setI] = useState(0);
  const line = dialogue.lines[steps[i]];
  const firstOpen = lessons.find((l) => !progress[l.id]?.completed && isUnlocked(l.id, l.requires, progress)) ?? lessons[0];
  const completed = lessons.filter((l) => progress[l.id]?.completed).length;

  useEffect(() => {
    document.title = 'Mission Control Academy';
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-signal-teal shadow-[0_0_12px_#2dd4bf]" aria-hidden />
          <span className="font-display text-sm font-semibold uppercase tracking-[0.25em] text-slate-300">Mission Control Academy</span>
        </div>
        <nav className="flex gap-2 text-sm">
          <button className="btn-ghost" onClick={() => navigate('/learn')}>Field guide</button>
          <button className="btn-ghost" onClick={() => navigate('/sandbox/first_fix')}>Sandbox</button>
        </nav>
      </header>

      <section className="mt-10 grid items-center gap-8 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <p className="chip mb-4">Orbit determination · state estimation · C++ physics in your browser</p>
          <h1 className="font-display text-4xl font-bold leading-tight text-white sm:text-5xl">
            Fly the console.<br /><span className="bg-gradient-to-r from-signal-cyan to-signal-teal bg-clip-text text-transparent">Find the spacecraft.</span>
          </h1>
          <p className="mt-4 max-w-xl text-base text-slate-300">
            You're the flight-dynamics operator. Predict, measure, correct — and learn why Kalman filters work, when they fail,
            and how to tell the difference from the residuals alone.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="btn-primary px-5 py-2.5 text-base" onClick={() => navigate(`/mission/${firstOpen.id}`)}>
              {returning ? `Continue: ${firstOpen.title}` : 'Start guided mission'}
            </button>
            <button className="btn-ghost px-5 py-2.5 text-base" onClick={() => navigate('/sandbox/first_fix')}>Free sandbox</button>
            <button className="btn-ghost px-5 py-2.5 text-base" onClick={() => navigate('/learn')}>Learn estimation</button>
          </div>
          <div className="mt-8 flex items-start gap-4">
            <BotAvatar mood={line?.mood ?? 'happy'} size={88} wave={i === 0} />
            <div className="flex-1" aria-live="polite">
              <BotBubble
                name={dialogue.bot.name}
                message={line ? { id: i, text: line.text, mood: line.mood } : undefined}
                onNext={() => setI((x) => (x + 1) % steps.length)}
                nextLabel={i < steps.length - 1 ? 'Next' : 'Again'}
              />
            </div>
          </div>
        </div>
        <div className="panel aspect-[400/260] overflow-hidden p-2">
          <OrbitPreview />
        </div>
      </section>

      <section className="mt-14" aria-labelledby="campaign">
        <div className="mb-4 flex items-end justify-between">
          <h2 id="campaign" className="font-display text-xl font-semibold text-white">Campaign</h2>
          <span className="text-sm text-slate-400">{completed} / {lessons.length} missions complete</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={lessons.length} aria-valuenow={completed} aria-label="Campaign progress">
          <div className="h-full bg-gradient-to-r from-signal-cyan to-signal-teal" style={{ width: `${(100 * completed) / Math.max(1, lessons.length)}%` }} />
        </div>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lessons.map((l) => {
            const unlocked = isUnlocked(l.id, l.requires, progress);
            const p = progress[l.id];
            return (
              <li key={l.id}>
                <button
                  className={`panel group flex h-full w-full flex-col p-4 text-left transition hover:border-signal-cyan/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-cyan ${unlocked ? '' : 'opacity-60'}`}
                  onClick={() => navigate(`/mission/${l.id}`)}
                  aria-label={`${l.title}${unlocked ? '' : ' (locked: complete earlier missions first, or open anyway)'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-signal-cyan">{l.codename}</span>
                    <span className="chip">{p?.completed ? '✓ complete' : unlocked ? l.difficulty : '🔒 locked'}</span>
                  </div>
                  <h3 className="mt-2 font-display text-lg font-semibold text-white">{l.title}</h3>
                  <p className="mt-1 flex-1 text-sm text-slate-400">{l.summary}</p>
                  {p?.best && (
                    <div className="mt-3 grid grid-cols-4 gap-1 text-center text-[10px] text-slate-400">
                      {(['accuracy', 'calibration', 'resources', 'success'] as const).map((k) => (
                        <div key={k}><div className="font-mono text-sm text-slate-200">{Math.round(p.best![k])}</div>{k}</div>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-14 grid gap-4 md:grid-cols-3">
        {[
          ['Real C++ physics', 'Two-body dynamics, RK4 with variational equations, EKF / UKF / particle filter / linear KF — compiled to WebAssembly.'],
          ['Honest scoring', 'Accuracy, uncertainty calibration (NEES/NIS), tracking cost and mission success are scored separately.'],
          ['Deterministic replays', 'Seeded noise and logged actions: save a run and replay it bit-for-bit, at any playback speed.'],
        ].map(([t, d]) => (
          <div key={t} className="panel p-4">
            <h3 className="font-display font-semibold text-white">{t}</h3>
            <p className="mt-1 text-sm text-slate-400">{d}</p>
          </div>
        ))}
      </section>
      <footer className="mt-12 text-xs text-slate-500">
        Runs locally in your browser — no accounts, no API keys. Units are SI internally; plots convert only for display.
      </footer>
    </main>
  );
}
