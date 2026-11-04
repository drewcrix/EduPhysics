import { useEffect, useState } from 'react';
import { loadCase } from '../data/loader';
import type { LoadedCase } from '../data/types';

/** Loads a case; the previous one stays on screen until the new one is ready (no flicker). */
export function useCase(id: string | null) {
  const [state, setState] = useState<{ loaded: LoadedCase | null; loading: boolean; error: string | null }>({ loaded: null, loading: !!id, error: null });
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadCase(id)
      .then((loaded) => alive && setState({ loaded, loading: false, error: null }))
      .catch((e: unknown) => alive && setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : String(e) })));
    return () => { alive = false; };
  }, [id]);
  return state;
}
