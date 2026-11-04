# Lesson authoring guide

Lessons, rules, the assistant's dialogue and concept cards are **JSON files** in
`simulations/orbital/content/`. The React code reads whatever is there; you never edit a
component to add or change teaching content. Text fields are **Markdown** with KaTeX maths
(`$inline$`, `$$display$$`; escape backslashes in JSON: `"$\\sigma$"`).

```
content/
├── lessons/NN-<id>.json      one file per mission (sorted by "order")
├── rules/*.json              global rules (apply in every mission and the sandbox)
├── bot/dialogue.json         ORBI's lines, onboarding script, control help, tips
└── concepts/*.json           Field Guide cards (also opened by rules)
```

Validate everything (schema **and** cross-references) with:

```bash
cd web && npm run validate:content
```

The same validation runs in the app: problems appear in a red banner instead of crashing.

## Lesson file

```jsonc
{
  "id": "tracking-blackout",          // lowercase-with-dashes; used in URLs (#/mission/<id>)
  "order": 2,                          // campaign position (unique)
  "title": "Tracking Blackout", "codename": "OPS-02",
  "difficulty": "core",                // intro | core | challenge
  "summary": "One sentence for the mission card.",
  "scenario": "tracking_blackout",     // id of a file in scenarios/
  "variants": [                        // optional extra experiments (selector in the top bar)
    { "id": "attitude", "label": "Attitude (12-state)", "scenario": "sensor_geometry_attitude" }
  ],
  "truthVisible": true,                // false = challenge: truth hidden until the debrief
  "requires": ["first-fix"],           // shown as locked until these are complete
  "unlocks": ["planned-burn"],
  "concepts": ["dead-reckoning"],      // Field Guide cards related to this mission
  "briefing":   { "markdown": "…" },
  "prediction": Question,              // asked BEFORE running; Play is disabled until answered
  "interactive": {
    "instructions": "…",
    "controls": ["sensors", "processNoise", "phaseStep", "observability"],
    "steps": ["optional numbered suggestions"]
  },
  "objectives": [ { "id": "grow", "text": "…", "required": true, "condition": Condition } ],
  "hints": [ { "id": "h1", "text": "…", "when": Condition /* optional */ } ],
  "rules": [ Rule ],                   // lesson-specific triggers (added to the global ones)
  "reasoning": Question,               // asked AFTER the run; unlocks the debrief
  "scoring": { "accuracyTargetM": 10, "resourceBudget": 600, "successMessage": "optional" },
  "debrief": { "markdown": "…", "placeholder": false }   // placeholder: true shows an "author placeholder" chip
}
```

`Question`:

```json
{ "prompt": "…", "explanation": "optional, shown after answering",
  "options": [ { "id": "a", "text": "…", "correct": true, "feedback": "…" }, … ] }
```

At least one option must be correct. Feedback for the prediction is revealed in the debrief.

`controls` decides which console sections appear: `sensors`, `noise` (assumed R slider),
`trueNoise`, `processNoise`, `estimator`, `maneuvers`, `observability`, `phaseStep`, `seed`,
`truthToggle`, `covarianceEditor`. The sandbox shows everything.

## Conditions

```jsonc
{ "metric": "alongTrackSigma", "op": ">", "value": 100 }
{ "event": "sensorToggled", "where": { "sensorType": "gnss_position", "enabled": false } }
{ "event": "assumedNoiseChanged", "where": { "ratio": { "op": ">", "value": 2 } } }
{ "flag": "showdownRun" }
{ "all": [ … ] }   { "any": [ … ] }   { "not": … }
```

Event conditions are true only while that event is being dispatched; metric/flag
conditions are evaluated on every simulation update. Objectives **latch**: once true they
stay complete for the run.

### Metrics (live, SI units)

| Metric | Meaning |
|---|---|
| `t`, `progress` | simulation time (s), t/duration |
| `posSigma` | √trace(P_rr) (m) |
| `alongTrackSigma` | 1σ along-track (m) |
| `posErr`, `nees`, `neesRecentNorm` | use truth — **omitted when truth is hidden** |
| `nisLastNorm`, `nisRecentNorm`, `nisMaxRecentNorm` | NIS / measurement dimension (latest, mean and max of last 5) |
| `updatesRecent` | measurements in the last 120 s |
| `outageActive` | 1 while an enabled sensor is in a scheduled outage |
| `sensorsEnabled` | count |
| `assumedNoiseRatio` | max over enabled sensors of assumed σ / true σ |
| `gimbal` | 1 near Euler gimbal lock |
| `finished` | 1 at the end of the mission |

### Events and their data

| Event | Data |
|---|---|
| `lessonStarted` | `lesson` |
| `simStarted`, `simFinished`, `reset` | — |
| `phaseStep` | `phase`: `predict` / `update` |
| `sensorToggled` | `sensor`, `sensorType`, `enabled` |
| `assumedNoiseChanged` | `sensor`, `sensorType`, `ratio` (assumed σ / true σ) |
| `trueNoiseChanged` | `sensor`, `ratio` |
| `processNoiseChanged` | `scale` (largest PSD entry / mission default) |
| `estimatorChanged` | `estimator`: `ekf` / `ukf` / `pf` / `kf` |
| `maneuverScheduled` | `known` (bool), `kind`: `impulse` / `finite` |
| `observabilityRun` | `rank`, `stateDim`, `deficient` (bool) |
| `predictionAnswered`, `reasoningAnswered` | `correct` (bool) |
| `truthToggled` | `visible` |

## Rules

```json
{ "id": "gnss-off", "once": true,
  "when": { "event": "sensorToggled", "where": { "sensorType": "gnss_position", "enabled": false } },
  "actions": [
    { "type": "say", "line": "rules.gnssOff" },
    { "type": "concept", "concept": "dead-reckoning" },
    { "type": "openPlot", "plot": "uncertainty" } ] }
```

Actions:

| Action | Effect |
|---|---|
| `say` | ORBI speaks: `line` (id in dialogue.json) **or** inline `text` (+ optional `mood`) |
| `concept` | adds a concept card to the Concepts tab |
| `highlight` | pulses a UI area: `sensors`, `noise`, `processNoise`, `estimator`, `maneuvers`, `observability`, `playback`, `phaseStep`, `plot:<name>`, `view3d`, `truthToggle`, `covarianceEditor`, `seed` |
| `openPlot` | switches the plot tab: `states`, `errors`, `uncertainty`, `innovations`, `nis`, `nees`, `sensors`, `controls` |
| `setFlag` | sets a flag for later conditions |
| `pause` | pauses playback |

`once` defaults to true. Rule ids must be unique across global + lesson rules.

## Dialogue file

```json
{ "bot": { "name": "ORBI", "tagline": "…" },
  "lines": { "rules.gnssOff": { "mood": "alert", "text": "…" } },
  "onboarding": ["welcome.first", "…"],          // welcome-screen script
  "controlHelp": { "sensors": "help.sensors" },   // the "?" buttons on console sections
  "idleTips": ["tip.innovation"] }
```

Moods: `happy`, `thinking`, `alert`, `celebrate`, `neutral` (they change ORBI's face/colour).

## Concept cards

```json
{ "concepts": [ { "id": "observability", "title": "…", "summary": "one line",
                  "body": "Markdown + maths", "lessons": ["sensor-geometry"], "placeholder": false } ] }
```

## Worked example

See [EXTENDING.md § Adding a lesson](EXTENDING.md#1-adding-a-lesson-worked-example) for a
complete new mission built from an existing scenario, including a rule and an objective.

## Writing tips

- Keep the briefing to what the student needs *before* running; save explanations for the debrief.
- Make the prediction falsifiable by something visible in the plots.
- Prefer objectives that require an *action* plus an *observation*.
- Use `truthVisible: false` only after students have learned to read innovations.
- Placeholders: the shipped debriefs marked `"placeholder": true` (Noisy Receiver, Planned
  Burn, Sensor Geometry) and the `reference-frames` concept are deliberately short — they are
  yours to extend.
