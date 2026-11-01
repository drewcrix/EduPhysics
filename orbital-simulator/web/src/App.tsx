import { useEffect, useMemo, useState } from 'react';
import { loadContent } from './lessons/content';
import { loadProgress, saveProgress, type Progress } from './lessons/progress';
import { WelcomeScreen } from './components/WelcomeScreen';
import { MissionControl } from './components/MissionControl';
import { LearnScreen } from './components/LearnScreen';

type Route = { screen: 'welcome' } | { screen: 'mission'; lesson: string } | { screen: 'sandbox'; scenario: string } | { screen: 'learn'; concept?: string };

function parseHash(): Route {
  const [, a, b] = window.location.hash.replace(/^#/, '').split('/');
  if (a === 'mission' && b) return { screen: 'mission', lesson: b };
  if (a === 'sandbox') return { screen: 'sandbox', scenario: b || 'first_fix' };
  if (a === 'learn') return { screen: 'learn', concept: b };
  return { screen: 'welcome' };
}

export function navigate(path: string) {
  window.location.hash = path;
}

export function App() {
  const content = useMemo(() => loadContent(), []);
  const [route, setRoute] = useState<Route>(parseHash);
  const [progress, setProgress] = useState<Progress>(loadProgress);

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const updateProgress = (p: Progress) => {
    setProgress(p);
    saveProgress(p);
  };

  return (
    <div className="min-h-full">
      {content.errors.length > 0 && (
        <div role="alert" className="border-b border-rose-500/40 bg-rose-950/80 px-4 py-2 text-sm text-rose-100">
          <strong>Content validation found {content.errors.length} problem(s)</strong> — fix the JSON under <code>content/</code>:
          <ul className="ml-5 list-disc">{content.errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {route.screen === 'welcome' && <WelcomeScreen content={content} progress={progress} />}
      {route.screen === 'learn' && <LearnScreen content={content} focus={route.concept} />}
      {route.screen === 'mission' && (() => {
        const lesson = content.lessons.find((l) => l.id === route.lesson);
        if (!lesson) return <NotFound what={`mission "${route.lesson}"`} />;
        return <MissionControl key={lesson.id} content={content} lesson={lesson} progress={progress} onProgress={updateProgress} />;
      })()}
      {route.screen === 'sandbox' && (
        content.scenarios[route.scenario]
          ? <MissionControl key={route.scenario} content={content} sandboxScenario={route.scenario} progress={progress} onProgress={updateProgress} />
          : <NotFound what={`scenario "${route.scenario}"`} />
      )}
    </div>
  );
}

function NotFound({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-lg p-10 text-center">
      <p className="text-slate-300">Could not find {what}.</p>
      <button className="btn-primary mt-4" onClick={() => navigate('/')}>Back to the academy</button>
    </div>
  );
}
