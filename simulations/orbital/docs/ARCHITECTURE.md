# Architecture

## Directory layout

```
orbital-simulator/
├── CMakeLists.txt, CMakePresets.json     build entry points (native, native-debug, wasm)
├── core/
│   ├── include/osim/                     public headers (one folder per module)
│   │   ├── types.hpp constants.hpp rng.hpp
│   │   ├── dynamics/      force_model, dynamics_model, orbital_dynamics, rigid_spacecraft_dynamics, cw_dynamics
│   │   ├── integrators/   rk4, propagator (variational equations)
│   │   ├── frames/        frames (ECI/ECEF/ENU/RTN/Kepler), attitude (Euler/DCM/quaternion)
│   │   ├── sensors/       sensor (MeasurementModel + Sensor), basic_sensors, ground_station, sensor_registry
│   │   ├── estimators/    estimator (+EKF), ukf, particle_filter, linear_kf, covariance_utils, estimator_registry
│   │   ├── simulation/    scenario, controls, simulation, json_util
│   │   └── diagnostics/   statistics (χ²), ellipsoid, observability, metrics
│   ├── src/…                             implementations (same structure)
│   ├── apps/osim_cli.cpp                 headless runner
│   ├── bindings/wasm_bindings.cpp        embind interface (the only browser entry point)
│   └── tests/                            doctest suites, one per module + regression
├── scenarios/*.json                      shared by C++ tests, CLI and web app
├── content/                              authored lessons, rules, bot dialogue, concepts
├── scripts/wasm_integration_test.mjs     WASM ↔ native check (CI)
├── web/                                  React app (Vite)
│   ├── src/sim/        worker, client, layout decoder, metrics, scoring, units, useMission
│   ├── src/lessons/    schema (zod), engine (rules/objectives), content loader, progress
│   ├── src/components/ screens and panels
│   ├── tests/          Vitest (engine, content, scoring, covariance, WASM)
│   └── e2e/            Playwright smoke tests
└── docs/
```

## Module responsibilities and contracts

| Module | Owns | Key interface |
|---|---|---|
| `dynamics` | ẋ = f(t,x,u) + G w, analytic A, B, G | `DynamicsModel`, `ForceModel` |
| `integrators` | RK4/Euler, Φ, Γ, Q_d | `propagate`, `propagate_variational` |
| `frames` | frame rotations, Kepler ↔ Cartesian, attitude | free functions |
| `sensors` | h, H, residual, schedule, outages, R_true vs R_assumed | `MeasurementModel` (estimator view), `Sensor` (truth view) |
| `estimators` | belief (mean, covariance or particles) | `Estimator`: `initialize / predict / update / apply_impulse` |
| `simulation` | truth, controls, node timeline, events, actions, history | `Simulation` |
| `diagnostics` | χ², ellipsoids, observability, run summary | free functions |
| `bindings` | JSON/typed-array bridge | `Simulation` class in `osim.mjs` |
| `web/sim` | worker RPC, playback, decoding | `SimClient`, `useMission` |
| `web/lessons` | lesson schema, rules, objectives | `RuleEngine`, `ObjectiveTracker` |

### Truth separation (enforced by types)

`Estimator::update(const MeasurementModel&, const Measurement&)` — `MeasurementModel`
exposes `h`, `H`, `residual`, `visible`, `filter_covariance` (built from `R_assumed`) and
nothing else. `Sensor` adds `simulate()` and `R_true`, and only the `Simulation` holds
`Sensor` objects and the true state. A test re-filters the logged measurements with a
fresh EKF and reproduces the run bit-for-bit, proving the estimate depends only on
measurements, controls and known-maneuver commands.

### Registries (plugin-like extension)

`EstimatorRegistry` and `SensorRegistry` map the scenario `"type"` string to a factory.
The UI lists whatever the estimator registry reports (`meta.estimators`), so adding a
filter needs no frontend change. See [EXTENDING.md](EXTENDING.md).

## Time, nodes and event ordering

The simulation advances through **nodes**: the union of

- the record grid `k·dt`,
- every sensor's sample times `phase + k·period` (enabled or not — so toggling a sensor
  never changes the truth's integration sub-steps),
- impulse times and thrust-segment boundaries (RK4 never integrates across a control
  discontinuity),
- the scenario end.

At each node `t_k` (node 0 is `t = 0` and starts in the update phase):

| Phase | Step | Detail |
|---|---|---|
| **Predict** | 1 | Controls for `[t_{k−1}, t_k)` are evaluated at `t_{k−1}` (zero-order hold): commanded → actual (truth) → measured (telemetry). |
| | 2 | Truth propagates with the *actual* control (+ true process noise if configured). |
| | 3 | Estimator predicts with the *measured* control if it knows about thrust, else zero. |
| | 4 | Impulses stamped `t_k`: truth gets the executed Δv (magnitude/pointing errors, noise); the estimator gets the commanded Δv and its assumed covariance **only if the burn is known**. |
| **Update** | 5 | For each sensor in scenario order with a sample at `t_k`: disabled → outage → visibility (from truth geometry) → support check → simulate with `R_true` and the keyed RNG → estimator update with `R_assumed`. |
| | 6 | Record: truth, prior and posterior estimate/covariance, wrapped error, NEES, RTN error/σ, controls, sensor statuses. |

User actions are applied at phase boundaries and logged as `{node, phase, action}`.
Replaying the log on a fresh `Simulation` reproduces the run exactly; tests check this
natively and in WebAssembly, and the browser smoke test checks that two different
playback speeds give the same hash.

## Randomness

`Rng(seed, stream, counter)` (xoshiro256** seeded through SplitMix64, Box–Muller normals,
no `std::*_distribution`). Streams: `sensor:<id>` keyed by the sample time in milliseconds, `telemetry` with
the node index, `impulse` with the burn index, `truth-process-noise` with the node index,
and `pf-*` streams with the PF's own counters and the estimator seed. Consequences:
the measurement noise on a given sample is identical whatever the estimator or the other
sensors, so comparisons are fair and replays are exact.

## Scenario schema (v1)

```jsonc
{
  "schemaVersion": 1,
  "id": "first_fix", "name": "First Fix", "description": "…",
  "seed": 1001,                              // truth, sensor, telemetry and burn noise
  "epoch": "2026-01-01T00:00:00Z",           // t = 0 (informational)
  "greenwichAngleAtEpochDeg": 0.0,           // ECEF/ECI alignment at t = 0
  "duration": 3000, "dt": 10,                // s; dt = record grid
  "model": "orbit6",                         // orbit6 | rigid12 | cw6
  "truth": {
    "mu": 3.986004418e14,
    "integrator": { "method": "rk4", "maxStep": 10 },   // or "euler"
    "spacecraft": { "mass": 100, "radius": 0.5, "inertia": [Ix, Iy, Iz] },  // rigid12 (and thrust mass)
    "processNoisePsd": 4e-10,                // true random acceleration PSD (scalar or per channel)
    "initialState": { "type": "circular", "altitudeM": 550000, "inclinationDeg": 51.6, "raanDeg": 30, "argLatDeg": 0 }
                    // or {"type":"keplerian","aM","e","iDeg","raanDeg","argpDeg","nuDeg"}
                    // or {"type":"cartesian","x":[…]}; rigid12 adds "eulerRad", "omegaRadS"
  },
  "controls": {
    "segments": [{ "label": "…", "start": 200, "end": 400, "thrustN": 20, "frame": "RTN", "direction": [0,1,0],
                   "torqueNm": [0,0,0], "torqueAmplitudeNm": [..], "torqueOmegaRadS": [..] }],
    "impulses": [{ "label": "…", "t": 1500, "dv": [0, 2, 0], "frame": "RTN", "known": true,
                   "trueMagnitudeError": 0.01, "truePointingErrorDeg": 0.5, "trueSigma": [..], "assumedSigma": [..] }],
    "trueScaleError": 0.0,                   // actual = (1 + e) · commanded
    "telemetrySigmaTrue": [..],              // measured = actual + noise (per control channel)
    "estimatorKnowsThrust": true
  },
  "sensors": [{
    "id": "gnss", "name": "GNSS receiver", "type": "gnss_position",   // gnss_pv | gyro | star_tracker | ground_station | ground_range
    "enabled": true, "period": 10, "phase": 0, "outages": [[1200, 3600]], "cost": 1,
    "trueSigma": [5,5,5],        // or "trueCovariance": [[…]]
    "assumedSigma": [5,5,5],     // or "assumedCovariance"; defaults to the true value
    "station": { "name": "…", "latDeg": 26, "lonDeg": 50, "altM": 300 }, "minElevationDeg": 10,   // ground_*
    "trueBias": [0,0,0]          // gyro only (not estimated)
  }],
  "estimator": {
    "type": "ekf",                         // ekf | ukf | pf | kf
    "model": { "mu": …, "integrator": {…}, "spacecraft": {…} },   // optional overrides → model mismatch
    "initialError": [..] | "initialEstimate": [..],
    "initialSigma": [..] | "initialCovariance": [[..]],
    "processNoisePsd": 1e-10 | [..] | "processNoiseCovariance": [[..]],
    "controlNoiseSigma": [..],             // assumed telemetry error (zero-order hold)
    "seed": 7,                             // estimator's own randomness (PF)
    "ukf": { "alpha": 1, "beta": 2, "kappa": 0 },
    "pf":  { "particles": 500, "resampleThreshold": 0.5, "roughening": true, "rougheningScale": 1 },
    "kf":  { "linearization": "reference" }   // or "frozen"
  }
}
```

Validation happens in C++ (`parse_scenario`): dimensions, symmetry, positive
(semi)definiteness (`cov::validate`), positive mass/inertia/μ/period, initial state above
the surface, known types. Errors are thrown as `ConfigError` with a sentence a student can
act on, and surface in the UI.

## WebAssembly interface

`core/bindings/wasm_bindings.cpp` exposes one class and three functions:

| Member | Returns |
|---|---|
| `init(scenarioJson)` | `{ok, meta}` or `{ok:false, error}` — `meta` has labels/units, sensors (with true/assumed covariances, station geometry, support reason), estimator list, maneuvers and the record **layout** |
| `step(n, mode)` | status; `mode` 0 = full node, 1 = predict only, 2 = update only |
| `runUntil(t)` | status |
| `action(json)` / `scheduleActions(log)` | status (+ refreshed `meta`) |
| `history(from)` / `innovations(from)` | packed `Float64Array` records from an index (layout in `meta.layout`) |
| `summary()`, `observability(window)`, `ellipsoid(k, p)` | JSON |
| `predictTrajectory(h, n)`, `particles(max)` | `Float64Array` (display only) |
| `actionLog()`, `hash()` | replay data |
| `chi2Quantile(p, k)`, `listEstimators()`, `listSensors()` | free functions |

Methods never throw into JavaScript. The worker (`web/src/sim/worker.ts`) keeps a
cursor and sends only new records; the main thread decodes them with
`web/src/sim/layout.ts` (tested against the real module).

## Frontend data flow

```
user input ──► useMission.act(action) ──► SimClient (serialised RPC) ──► worker ──► wasm
                     │                                                        │
                     ├─► lesson event (sensorToggled, assumedNoiseChanged …)  │
                     ▼                                                        ▼
               RuleEngine.dispatch ──► actions (say/concept/highlight/openPlot/pause)
                     ▲
playback rAF loop ──► runUntil(target) ──► delta ──► appendHistory ──► metrics ──► RuleEngine.tick
                                                                               └► ObjectiveTracker
```

Rendering (three.js, `frameloop="demand"`) and plotting (uPlot) read the decoded column
store; they never advance the simulation. When WebGL is unavailable, a 2-D orbit-plane
canvas is shown instead.

## Decisions and alternatives considered

| Decision | Why | Alternative |
|---|---|---|
| JSON for metadata, packed `Float64Array` for history | small infrequent vs large streamed data | all-JSON (slow), SharedArrayBuffer (needs COOP/COEP headers) |
| Web Worker owns the simulation | UI stays responsive; requests serialised → deterministic | main-thread wasm |
| uPlot instead of Plotly | 50 KB, handles 100k points, canvas | Plotly (3.5 MB) |
| three.js without drei | fewer dependencies; only OrbitControls needed | @react-three/drei |
| JSON + zod for lessons, Markdown + KaTeX strings | validated, diff-friendly, no build step for authors | MDX (needs compilation, can run code) |
| Counter-keyed RNG | fairness across estimators and toggles; exact replay | single sequential stream |
| Node set includes disabled sensors' times | truth independent of UI toggles | only enabled sensors |
