# Feature extension guide

The core is organised so each kind of extension touches one module. Nothing below requires
changes to unrelated estimators, sensors or React components.

## 1. Adding a lesson (worked example)

Goal: a mission *"Cross-Track Check"* showing that GNSS position fixes determine an orbit
plane quickly, using the existing First Fix physics but a sparser receiver.

**Step 1 — scenario** (`scenarios/cross_track_check.json`): copy `first_fix.json`, change
`"id"` to `"cross_track_check"`, set the GNSS `"period"` to `60`, and give the estimator a
cross-track error: `"initialError": [0, 0, 3000, 0, 0, 3.0]`.

**Step 2 — lesson** (`content/lessons/08-cross-track-check.json`):

```json
{
  "id": "cross-track-check", "order": 8, "title": "Cross-Track Check", "codename": "OPS-08",
  "difficulty": "core", "summary": "How fast do sparse GNSS fixes pin down the orbit plane?",
  "scenario": "cross_track_check", "truthVisible": true,
  "requires": ["first-fix"], "unlocks": [], "concepts": ["covariance", "observability"],
  "briefing": { "markdown": "The estimate's orbit plane is tilted: **3 km** cross-track. Fixes arrive once a minute." },
  "prediction": {
    "prompt": "Which uncertainty shrinks first after the first fix?",
    "options": [
      { "id": "n", "text": "Cross-track position", "correct": true, "feedback": "A position fix measures it directly." },
      { "id": "v", "text": "Cross-track velocity", "correct": false, "feedback": "Velocity needs a second fix through the dynamics." }
    ]
  },
  "interactive": { "instructions": "Play and watch the **Uncertainty** plot (N curve).", "controls": ["noise", "observability", "phaseStep"] },
  "objectives": [
    { "id": "plane", "text": "Cross-track σ below 20 m", "required": true,
      "condition": { "all": [ { "metric": "t", "op": ">", "value": 0 }, { "metric": "posSigma", "op": "<", "value": 20 } ] } },
    { "id": "finish", "text": "Finish", "required": true, "condition": { "metric": "finished", "op": "==", "value": 1 } }
  ],
  "rules": [
    { "id": "ctc-second-fix", "when": { "metric": "t", "op": ">=", "value": 60 },
      "actions": [ { "type": "say", "text": "Second fix in: now the *velocity* out of plane is observable.", "mood": "thinking" },
                   { "type": "openPlot", "plot": "uncertainty" } ] }
  ],
  "reasoning": {
    "prompt": "Why does cross-track error oscillate once per orbit when uncorrected?",
    "options": [
      { "id": "a", "text": "A tilted plane crosses the true one twice per orbit.", "correct": true, "feedback": "Right — a plane rotation shows up as a once-per-orbit sinusoid." },
      { "id": "b", "text": "GNSS noise is periodic.", "correct": false, "feedback": "The noise is white." }
    ]
  },
  "scoring": { "accuracyTargetM": 10, "resourceBudget": 100 },
  "debrief": { "markdown": "Your explanation here.", "placeholder": true }
}
```

**Step 3 — validate and play:** `cd web && npm run validate:content`, then open
`#/mission/cross-track-check`. The welcome screen shows the new card automatically.

## 2. Adding a force model (J2) — no stubs needed

Force models are the only place where orbital physics enters; estimators consume
whatever `DynamicsModel::f`/`jacobian` return, and the frontend never sees forces.

1. **Header** `core/include/osim/dynamics/force_model.hpp`: declare
   `class J2Gravity final : public ForceModel` with `name()`, `acceleration()` and
   `partials()`, storing μ, R_E and J2 = 1.08262668×10⁻³.
2. **Physics** in a new `core/src/dynamics/j2_gravity.cpp`, with z along the spin axis:

   ```
   k = −(3/2) J2 μ R_E² / r⁵
   a = k [ x (1 − 5 z²/r²),  y (1 − 5 z²/r²),  z (3 − 5 z²/r²) ]
   ```

   For `partials`, differentiate each component with respect to x, y, z (∂a/∂v = 0).
   The algebra is mechanical; a finite-difference test catches mistakes.
3. **Build**: add the `.cpp` to `OSIM_SOURCES` in `core/CMakeLists.txt`.
4. **Wiring**: in `build_model()` (`core/src/simulation/scenario.cpp`), push a
   `J2Gravity` into `forces` when the model spec asks for it, e.g. a new
   `ModelSpec::j2` flag read from `"truth": {"forces": ["point_mass", "j2"]}` and the
   same key under `"estimator": {"model": …}`. Putting it under both truth and estimator
   lets you teach model mismatch (truth with J2, filter without).
5. **Tests**: add to `core/tests/test_dynamics.cpp` a finite-difference check of
   `J2Gravity::partials` (copy the orbit6 test), and to `test_integrators.cpp` a check
   that the RAAN drift rate over a few orbits matches
   Ω̇ = −(3/2) n J2 (R_E/p)² cos i — an *independent* analytic reference.
6. **Docs**: describe the new key in ARCHITECTURE.md's scenario schema.

Drag and solar radiation pressure follow the same pattern (drag also contributes ∂a/∂v).
A third-body force needs an ephemeris r_b(t) and must include the indirect term
−μ_b r_b/‖r_b‖³ (see MATH_AND_UNITS.md §9).

## 3. Adding a sensor

1. Subclass `Sensor` (implement `type`, `dim`, `labels`, `h`, `H`; override `visible`,
   `simulate`, `filter_covariance` or `unsupported_reason` if needed). Call
   `check_noise_dims()` in the constructor.
2. Register it in the `SensorRegistry` constructor (`core/src/sensors/sensor_registry.cpp`)
   with a JSON factory; reuse `parse_common_sensor_config(j, dim)`.
3. Test `H` against finite differences in `test_sensors.cpp`.
The UI picks up the new sensor from `meta.sensors` (labels and units included).

## 4. Adding an estimator

1. Implement the `Estimator` interface (`initialize`, `predict`, `update`,
   `apply_impulse`, `mean`, `covariance`; optionally `unsupported_reason`).
2. Register it in the `EstimatorRegistry` constructor with an `EstimatorInfo` (type,
   display name, one-line summary, stochastic flag).
3. Add it to the "every estimator keeps P symmetric and PSD" and "every scenario runs"
   loops in the tests.
The estimator picker and the showdown table list registered estimators automatically
(the showdown's contestant list is in `ShowdownPanel.tsx` if you want it in the race).

## 5. Quaternion attitude (future)

Create `QuaternionSpacecraftDynamics` with a 13-element state (q instead of e) and a
12-element error state. The interface already separates `normalize` (re-normalise q) and
`state_difference` (return the rotation-vector error), which is what an error-state
(multiplicative) EKF needs; covariance would be 12×12 on the error state.

## 6. Multiple spacecraft / ground stations

Ground stations are just sensors (add more entries to `"sensors"`). Multiple spacecraft
would be a new `DynamicsModel` whose state stacks several 6-state blocks, with
inter-satellite range sensors implementing `MeasurementModel`.
