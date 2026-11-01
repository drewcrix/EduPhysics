// Field Guide: every concept card from content/concepts, with links to the missions that use it.
import { useEffect, useState } from 'react';
import type { Content } from '../lessons/content';
import { navigate } from '../App';
import { Markdown } from './Markdown';
import { BotAvatar } from './Bot';

export function LearnScreen({ content, focus }: { content: Content; focus?: string }) {
  const [open, setOpen] = useState<string | undefined>(focus ?? content.concepts[0]?.id);
  useEffect(() => {
    document.title = 'Field Guide — Mission Control Academy';
  }, []);
  const c = content.concepts.find((x) => x.id === open);
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <button className="btn-ghost" onClick={() => navigate('/')}>← Academy</button>
        <h1 className="font-display text-2xl font-bold text-white">Field Guide</h1>
        <button className="btn-primary" onClick={() => navigate('/mission/first-fix')}>Fly a mission</button>
      </header>
      <div className="mt-6 grid gap-4 md:grid-cols-[260px_1fr]">
        <nav aria-label="Concepts" className="panel h-fit p-2">
          <ul>
            {content.concepts.map((x) => (
              <li key={x.id}>
                <button className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${open === x.id ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5'}`} onClick={() => setOpen(x.id)} aria-current={open === x.id}>
                  {x.title}{x.placeholder && <span className="ml-1 text-[10px] text-amber-300">draft</span>}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        {c && (
          <article className="panel p-5">
            <div className="flex items-start gap-4">
              <BotAvatar mood="thinking" size={64} />
              <div>
                <h2 className="font-display text-xl font-semibold text-white">{c.title}</h2>
                <p className="text-sm text-slate-400">{c.summary}</p>
              </div>
            </div>
            <Markdown className="mt-4 text-[15px]">{c.body}</Markdown>
            {c.lessons.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="label self-center">Practise in:</span>
                {c.lessons.map((l) => {
                  const lesson = content.lessons.find((x) => x.id === l);
                  return lesson ? <button key={l} className="btn-ghost" onClick={() => navigate(`/mission/${l}`)}>{lesson.title}</button> : null;
                })}
              </div>
            )}
          </article>
        )}
      </div>
    </main>
  );
}
