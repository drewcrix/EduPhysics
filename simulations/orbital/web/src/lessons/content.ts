// Load and validate all authored content (lessons, rules, dialogue, concepts) and the
// shared scenario files. Problems are collected into `errors` and shown to authors in the
// UI instead of crashing the app.
import { ConceptFileSchema, DialogueSchema, LessonSchema, RuleFileSchema } from './schema';
import type { Concept, Dialogue, Lesson, Rule } from './schema';

export interface Content {
  lessons: Lesson[];
  globalRules: Rule[];
  dialogue: Dialogue;
  concepts: Concept[];
  scenarios: Record<string, Record<string, unknown>>;
  errors: string[];
}

type Files = Record<string, unknown>;

const name = (path: string) => path.split('/').pop() ?? path;

export function buildContent(files: {
  lessons: Files;
  rules: Files;
  dialogue: Files;
  concepts: Files;
  scenarios: Files;
}): Content {
  const errors: string[] = [];
  const parse = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: { path: (string | number)[]; message: string }[] } } }, value: unknown, where: string): T | null => {
    const r = schema.safeParse(value);
    if (r.success) return r.data as T;
    for (const i of r.error!.issues) errors.push(`${where}: ${i.path.join('.') || '(root)'} — ${i.message}`);
    return null;
  };

  const scenarios: Record<string, Record<string, unknown>> = {};
  for (const [p, v] of Object.entries(files.scenarios)) {
    const s = v as Record<string, unknown>;
    if (typeof s?.id !== 'string') errors.push(`${name(p)}: scenario has no "id"`);
    else scenarios[s.id] = s;
  }

  const lessons: Lesson[] = [];
  for (const [p, v] of Object.entries(files.lessons)) {
    const l = parse<Lesson>(LessonSchema, v, name(p));
    if (l) lessons.push(l);
  }
  lessons.sort((a, b) => a.order - b.order);

  const globalRules: Rule[] = [];
  for (const [p, v] of Object.entries(files.rules)) {
    const f = parse<{ rules: Rule[] }>(RuleFileSchema, v, name(p));
    if (f) globalRules.push(...f.rules);
  }

  let dialogue: Dialogue = { bot: { name: 'ORBI', tagline: '' }, lines: {}, onboarding: [], controlHelp: {}, idleTips: [] };
  const dv = Object.values(files.dialogue)[0];
  if (dv) dialogue = parse<Dialogue>(DialogueSchema, dv, 'dialogue.json') ?? dialogue;
  else errors.push('content/bot/dialogue.json is missing');

  const concepts: Concept[] = [];
  for (const [p, v] of Object.entries(files.concepts)) {
    const f = parse<{ concepts: Concept[] }>(ConceptFileSchema, v, name(p));
    if (f) concepts.push(...f.concepts);
  }

  // Cross-references
  const lessonIds = new Set(lessons.map((l) => l.id));
  const conceptIds = new Set(concepts.map((c) => c.id));
  const checkRules = (rules: Rule[], where: string) => {
    for (const r of rules)
      for (const a of r.actions) {
        if (a.type === 'say' && a.line && !dialogue.lines[a.line]) errors.push(`${where} rule "${r.id}": unknown dialogue line "${a.line}"`);
        if (a.type === 'concept' && !conceptIds.has(a.concept)) errors.push(`${where} rule "${r.id}": unknown concept "${a.concept}"`);
      }
  };
  checkRules(globalRules, 'global');
  const seenOrder = new Set<number>();
  for (const l of lessons) {
    if (!scenarios[l.scenario]) errors.push(`lesson ${l.id}: scenario "${l.scenario}" not found in scenarios/`);
    for (const v of l.variants) if (!scenarios[v.scenario]) errors.push(`lesson ${l.id}: variant scenario "${v.scenario}" not found`);
    for (const u of [...l.unlocks, ...l.requires]) if (!lessonIds.has(u)) errors.push(`lesson ${l.id}: unknown lesson "${u}" in unlocks/requires`);
    for (const c of l.concepts) if (!conceptIds.has(c)) errors.push(`lesson ${l.id}: unknown concept "${c}"`);
    if (seenOrder.has(l.order)) errors.push(`lesson ${l.id}: duplicate order ${l.order}`);
    seenOrder.add(l.order);
    checkRules(l.rules, `lesson ${l.id}`);
  }
  for (const id of [...dialogue.onboarding, ...dialogue.idleTips, ...Object.values(dialogue.controlHelp)])
    if (!dialogue.lines[id]) errors.push(`dialogue.json: unknown line "${id}"`);
  for (const c of concepts) for (const l of c.lessons) if (!lessonIds.has(l)) errors.push(`concept ${c.id}: unknown lesson "${l}"`);

  return { lessons, globalRules, dialogue, concepts, scenarios, errors };
}

let cached: Content | null = null;

/** Content bundled by Vite at build time. */
export function loadContent(): Content {
  cached ??= buildContent({
    lessons: import.meta.glob('@content/lessons/*.json', { eager: true, import: 'default' }),
    rules: import.meta.glob('@content/rules/*.json', { eager: true, import: 'default' }),
    dialogue: import.meta.glob('@content/bot/dialogue.json', { eager: true, import: 'default' }),
    concepts: import.meta.glob('@content/concepts/*.json', { eager: true, import: 'default' }),
    scenarios: import.meta.glob('@scenarios/*.json', { eager: true, import: 'default' }),
  });
  return cached;
}
