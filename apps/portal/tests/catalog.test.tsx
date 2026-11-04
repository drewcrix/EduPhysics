import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App';
import { simulators } from '../src/catalog';

describe('simulator catalogue', () => {
  it('has unique ids and relative links that the site build provides', () => {
    expect(new Set(simulators.map((s) => s.id)).size).toBe(simulators.length);
    for (const s of simulators) {
      expect(s.href).toMatch(/^\.\/[a-z-]+\/$/);
      expect(s.topics.length).toBeGreaterThan(0);
    }
    expect(simulators.filter((s) => s.status === 'available').map((s) => s.id)).toEqual(['orbital', 'fluids']);
  });

  it('renders a card with a working link for every available simulator', () => {
    const html = renderToStaticMarkup(<App />);
    for (const s of simulators.filter((x) => x.status === 'available')) {
      expect(html).toContain(s.title);
      expect(html).toContain(`href="${s.href}"`);
    }
  });
});
