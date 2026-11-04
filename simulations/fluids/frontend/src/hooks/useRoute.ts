import { useCallback, useEffect, useState } from 'react';

export type Page = 'simulator' | 'boundaries' | 'high-lift' | 'theory';
const PAGES: Page[] = ['simulator', 'boundaries', 'high-lift', 'theory'];

export interface Route {
  page: Page;
  params: URLSearchParams;
  /** Section anchor within a page, e.g. #/theory/kutta. */
  section?: string;
}

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const [page, section] = path.split('/');
  return { page: PAGES.includes(page as Page) ? (page as Page) : 'simulator', section, params: new URLSearchParams(query) };
}

export function hrefFor(page: Page, params?: Record<string, string | number>, section?: string): string {
  const q = params ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : '';
  return `#/${page}${section ? `/${section}` : ''}${q ? `?${q}` : ''}`;
}

/** Hash routing (works on any static host and any base path). */
export function useRoute(): [Route, (hash: string, replace?: boolean) => void] {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((hash: string, replace = false) => {
    if (replace) {
      window.history.replaceState(null, '', hash);
      setRoute(parseHash(hash));
    } else {
      window.location.hash = hash;
    }
  }, []);
  return [route, go];
}
