// Declarative schema for lessons, rules, bot dialogue and concept cards.
// Every JSON file under orbital-simulator/content/ is validated against these schemas
// (at build time by tests/content.test.ts and at runtime when loaded).
import { z } from 'zod';

/** Live metrics a condition can read. Units: SI (m, s), NIS/NEES dimensionless. */
export const METRICS = [
  't', //               simulation time (s)
  'progress', //        t / duration (0..1)
  'posSigma', //        1σ position uncertainty, sqrt(trace P_rr) (m)
  'alongTrackSigma', // 1σ along-track uncertainty (m)
  'posErr', //          |position error| (m) — evaluation only, uses truth
  'nees', //            latest NEES (uses truth)
  'neesRecentNorm', //  mean NEES/n over the last 10 records
  'nisLastNorm', //     latest NIS / measurement dimension
  'nisRecentNorm', //   mean NIS/dim over the last 5 updates
  'nisMaxRecentNorm', //max NIS/dim over the last 5 updates
  'updatesRecent', //   measurements processed in the last 120 s of sim time
  'outageActive', //    1 if any enabled sensor is in a scheduled outage now
  'finished', //        1 when the mission has ended
  'gimbal', //          1 when near Euler gimbal lock
  'sensorsEnabled', //  number of enabled sensors
  'assumedNoiseRatio', // max over sensors of assumed σ / true σ
] as const;
export type MetricName = (typeof METRICS)[number];

export const EVENTS = [
  'lessonStarted',
  'simStarted',
  'simFinished',
  'reset',
  'phaseStep',
  'sensorToggled',
  'assumedNoiseChanged',
  'trueNoiseChanged',
  'processNoiseChanged',
  'estimatorChanged',
  'maneuverScheduled',
  'observabilityRun',
  'predictionAnswered',
  'reasoningAnswered',
  'truthToggled',
] as const;
export type EventName = (typeof EVENTS)[number];

const Primitive = z.union([z.string(), z.number(), z.boolean()]);
const Op = z.enum(['<', '<=', '>', '>=', '==', '!=']);
const Comparison = z.object({ op: Op, value: z.number() }).strict();

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { event: EventName; where?: Record<string, z.infer<typeof Primitive> | z.infer<typeof Comparison>> }
  | { metric: MetricName; op: z.infer<typeof Op>; value: number }
  | { flag: string };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ any: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
    z.object({ event: z.enum(EVENTS), where: z.record(z.union([Primitive, Comparison])).optional() }).strict(),
    z.object({ metric: z.enum(METRICS), op: Op, value: z.number() }).strict(),
    z.object({ flag: z.string().min(1) }).strict(),
  ]),
);

export const UI_TARGETS = [
  'sensors', 'noise', 'processNoise', 'estimator', 'maneuvers', 'observability', 'playback', 'phaseStep',
  'plot:states', 'plot:errors', 'plot:innovations', 'plot:nis', 'plot:nees', 'plot:uncertainty', 'plot:sensors', 'plot:controls',
  'view3d', 'truthToggle', 'covarianceEditor', 'seed',
] as const;

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('say'), line: z.string().optional(), text: z.string().optional(), mood: z.enum(['happy', 'thinking', 'alert', 'celebrate', 'neutral']).optional() }).strict(),
  z.object({ type: z.literal('concept'), concept: z.string() }).strict(),
  z.object({ type: z.literal('highlight'), target: z.enum(UI_TARGETS) }).strict(),
  z.object({ type: z.literal('openPlot'), plot: z.enum(['states', 'errors', 'innovations', 'nis', 'nees', 'uncertainty', 'sensors', 'controls']) }).strict(),
  z.object({ type: z.literal('setFlag'), flag: z.string() }).strict(),
  z.object({ type: z.literal('pause') }).strict(),
]).superRefine((a, ctx) => {
  if (a.type === 'say' && !!a.line === !!a.text) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'say needs exactly one of "line" or "text"' });
});
export type Action = z.infer<typeof ActionSchema>;

export const RuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  when: ConditionSchema,
  once: z.boolean().default(true),
  actions: z.array(ActionSchema).min(1),
}).strict();
export type Rule = z.infer<typeof RuleSchema>;

export const QuestionSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(z.object({ id: z.string(), text: z.string(), correct: z.boolean().default(false), feedback: z.string() }).strict()).min(2),
  explanation: z.string().optional(),
}).strict().refine((q) => q.options.some((o) => o.correct), 'a question needs at least one correct option');
export type Question = z.infer<typeof QuestionSchema>;

export const CONTROLS = ['sensors', 'noise', 'trueNoise', 'processNoise', 'estimator', 'maneuvers', 'observability', 'phaseStep', 'seed', 'truthToggle', 'covarianceEditor'] as const;

export const LessonSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  order: z.number().int(),
  title: z.string(),
  codename: z.string(),
  summary: z.string(),
  difficulty: z.enum(['intro', 'core', 'challenge']),
  scenario: z.string(),
  variants: z.array(z.object({ id: z.string(), label: z.string(), scenario: z.string(), description: z.string().optional() }).strict()).default([]),
  truthVisible: z.boolean(),
  requires: z.array(z.string()).default([]),
  unlocks: z.array(z.string()).default([]),
  concepts: z.array(z.string()).default([]),
  briefing: z.object({ markdown: z.string() }).strict(),
  prediction: QuestionSchema,
  interactive: z.object({
    instructions: z.string(),
    controls: z.array(z.enum(CONTROLS)),
    steps: z.array(z.string()).default([]),
  }).strict(),
  objectives: z.array(z.object({ id: z.string(), text: z.string(), required: z.boolean().default(true), condition: ConditionSchema }).strict()).min(1),
  hints: z.array(z.object({ id: z.string(), text: z.string(), when: ConditionSchema.optional() }).strict()).default([]),
  rules: z.array(RuleSchema).default([]),
  reasoning: QuestionSchema,
  scoring: z.object({
    accuracyTargetM: z.number().positive(),
    resourceBudget: z.number().positive(),
    successMessage: z.string().optional(),
  }).strict(),
  debrief: z.object({ markdown: z.string(), placeholder: z.boolean().default(false) }).strict(),
}).strict();
export type Lesson = z.infer<typeof LessonSchema>;

export const RuleFileSchema = z.object({ description: z.string().optional(), rules: z.array(RuleSchema) }).strict();

export const DialogueSchema = z.object({
  bot: z.object({ name: z.string(), tagline: z.string() }).strict(),
  lines: z.record(z.object({ text: z.string(), mood: z.enum(['happy', 'thinking', 'alert', 'celebrate', 'neutral']).default('neutral') }).strict()),
  onboarding: z.array(z.string()),
  controlHelp: z.record(z.string()),
  idleTips: z.array(z.string()),
}).strict();
export type Dialogue = z.infer<typeof DialogueSchema>;

export const ConceptFileSchema = z.object({
  concepts: z.array(z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    body: z.string(),
    lessons: z.array(z.string()).default([]),
    placeholder: z.boolean().default(false),
  }).strict()),
}).strict();
export type Concept = z.infer<typeof ConceptFileSchema>['concepts'][number];
