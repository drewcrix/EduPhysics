// Per-browser progress (a convenience only). Every access is guarded: storage can be
// unavailable in private windows, previews or with blocked site data.
export interface LessonProgress {
  completed: boolean;
  best?: { accuracy: number; calibration: number; resources: number; success: number };
  attempts: number;
}
export type Progress = Record<string, LessonProgress>;

const KEY = 'mca.progress.v1';

export function loadProgress(): Progress {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Progress) : {};
  } catch {
    return {};
  }
}

export function saveProgress(p: Progress) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

export function isUnlocked(lessonId: string, requires: string[], progress: Progress) {
  return requires.every((r) => progress[r]?.completed) || lessonId === 'first-fix';
}
