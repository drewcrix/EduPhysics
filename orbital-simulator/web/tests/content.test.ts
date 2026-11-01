// Validates every authored content file (run with `npm run validate:content`).
import { describe, expect, it } from 'vitest';
import { loadContent } from '../src/lessons/content';

describe('authored content', () => {
  const c = loadContent();
  it('has no schema or cross-reference errors', () => {
    expect(c.errors).toEqual([]);
  });
  it('contains the seven campaign missions in order', () => {
    expect(c.lessons.map((l) => l.id)).toEqual([
      'first-fix', 'tracking-blackout', 'noisy-receiver', 'planned-burn', 'unexpected-burn', 'sensor-geometry', 'filter-showdown',
    ]);
  });
  it('every lesson has a prediction, an interactive action, objectives, a reasoning question and a debrief', () => {
    for (const l of c.lessons) {
      expect(l.prediction.options.some((o) => o.correct)).toBe(true);
      expect(l.interactive.instructions.length).toBeGreaterThan(10);
      expect(l.objectives.length).toBeGreaterThan(0);
      expect(l.reasoning.options.length).toBeGreaterThanOrEqual(2);
      expect(l.debrief.markdown.length).toBeGreaterThan(20);
    }
  });
  it('loads every shared scenario', () => {
    for (const id of ['first_fix', 'tracking_blackout', 'filter_showdown', 'linear_lab_cw', 'sensor_geometry_attitude'])
      expect(c.scenarios[id]).toBeDefined();
  });
  it('dialogue has onboarding lines', () => {
    expect(c.dialogue.onboarding.length).toBeGreaterThan(2);
  });
});
