// ORBI, the mission assistant: an animated SVG character with a speech bubble.
// Behaviour is deterministic and rule-driven (content/bot/dialogue.json + rules).
import { Markdown } from './Markdown';
import type { BotMessage } from '../sim/useMission';

const moodColor: Record<BotMessage['mood'], string> = {
  happy: '#38e1ff', thinking: '#a78bfa', alert: '#fbbf24', celebrate: '#2dd4bf', neutral: '#38e1ff',
};

export function BotAvatar({ mood = 'happy', size = 96, wave = false }: { mood?: BotMessage['mood']; size?: number; wave?: boolean }) {
  const c = moodColor[mood];
  const mouth = mood === 'alert' ? 'M38 60 Q48 56 58 60' : mood === 'thinking' ? 'M40 60 L56 59' : 'M38 57 Q48 66 58 57';
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" role="img" aria-label={`ORBI the mission assistant, looking ${mood}`} className="anim-float drop-shadow-[0_0_18px_rgba(56,225,255,0.35)]">
      <defs>
        <radialGradient id="orbi-body" cx="40%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#2b4a8f" />
          <stop offset="100%" stopColor="#0d1a3a" />
        </radialGradient>
      </defs>
      {/* orbit ring */}
      <ellipse cx="48" cy="54" rx="44" ry="12" fill="none" stroke={c} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="4 6" className="anim-orbit" />
      {/* antenna */}
      <line x1="48" y1="20" x2="48" y2="10" stroke="#94a3b8" strokeWidth="2" />
      <circle cx="48" cy="8" r="4" fill={c} className="anim-antenna" />
      {/* head */}
      <rect x="20" y="20" width="56" height="50" rx="20" fill="url(#orbi-body)" stroke={c} strokeOpacity="0.7" strokeWidth="2" />
      {/* visor */}
      <rect x="27" y="31" width="42" height="26" rx="12" fill="#050914" stroke={c} strokeOpacity="0.4" />
      <g className="anim-blink">
        <circle cx="39" cy="43" r="4.5" fill={c} />
        <circle cx="57" cy="43" r="4.5" fill={c} />
      </g>
      <path d={mouth} stroke={c} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {/* side panels */}
      <rect x="13" y="36" width="7" height="18" rx="3" fill="#1b2b52" stroke={c} strokeOpacity="0.5" />
      <rect x="76" y="36" width="7" height="18" rx="3" fill="#1b2b52" stroke={c} strokeOpacity="0.5" />
      {/* waving arm */}
      <g transform="translate(78 62)">
        <g className={wave ? 'anim-wave' : ''}>
          <rect x="0" y="0" width="14" height="6" rx="3" fill="#27407a" transform="rotate(-35)" />
        </g>
      </g>
    </svg>
  );
}

export function BotBubble({ message, name = 'ORBI', onNext, nextLabel }: { message?: BotMessage; name?: string; onNext?: () => void; nextLabel?: string }) {
  if (!message) return null;
  return (
    <div className="relative rounded-xl border border-signal-cyan/25 bg-space-800/90 p-3 shadow-glow anim-fade-up" key={message.id}>
      <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-signal-cyan">
        {name}
        <span className="chip normal-case tracking-normal">{message.mood}</span>
      </div>
      <Markdown>{message.text}</Markdown>
      {onNext && (
        <div className="mt-2 flex justify-end">
          <button className="btn-ghost" onClick={onNext}>{nextLabel ?? 'Next'}</button>
        </div>
      )}
    </div>
  );
}
