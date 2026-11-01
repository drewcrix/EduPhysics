# Build Journal — Mission Control Academy (orbital-simulator)

A chronological log of what was done, why, and what the checks showed. Entries are
added as the work proceeds; newest entries are at the bottom. Commands are given as they
were actually run (paths relative to `orbital-simulator/` unless stated).

---

## Entry 1 — Repository inspection (read-only)

**What was inspected.** The workspace root `EduPhysics/` contained only
`Python_Orbit_determination/state_estimators/` with four Python files (`model.py`,
`integrator.py`, `orbital_ekf.py`, `graphics.py`) and `__pycache__`. There is **no `.git`
directory and no `.github/` directory** in the workspace, so there are no existing Git
settings or workflows that could collide with new files. No file named `orbital-simulator`
existed, so that name was chosen for the new application directory.

**Nothing in `Python_Orbit_determination/` was modified, moved, formatted or executed.**

### Interfaces and conventions found in the reference code

| Item | Reference implementation | Carried into C++ as |
|---|---|---|
| Dynamics | `Satallite_Orbiter.f(x, u)` returns `ẋ` for a 12-state body | `RigidSpacecraftDynamics::f(t, x, u)` |
| Jacobian | `jacobian(x, u)` analytic `A = ∂f/∂x` | `jacobian(t, x, u)` (same entries + gyroscopic terms) |
| Input matrix | `process_noise_matrix(x)` = `G = ∂f/∂u` (12×4) | `control_matrix(t, x, u)` |
| Integrator | `rk_four(f, x, u, T)` with zero-order-hold input | `rk_four(model, t, x, u, T)` |
| EKF | `satallite_GNSS_ekf(u_m, y, Q, R, x, P, T)` | `Ekf::predict` / `Ekf::update` |
| Names | `x`, `u`, `u_m`, `y`, `T` (sample period), `F`, `L`, `G`, `H`, `K`, `P_new`, `x_hat`, `P_hat` | Same short mathematical names inside numerical code |
| Comment style | Short imperative line comments ("Compute a priori estimate", "Numerically help the covariance matrix stay symmetric"), docstrings stating assumptions | Same style in `//` comments and Doxygen-lite header comments |
| State order | `[x y z vx vy vz φ θ ψ ωx ωy ωz]`, ZYX Euler, thrust along body x | Identical |
| Units | SI (m, s, kg, N, N·m, rad) | Identical |
| Sphere inertia | `I = 0.4 m R²` | `inertia_sphere(m, R)` default |
| Confidence bounds | `chi2.isf(0.01, 1)` for per-coordinate 99 % bands; `chi2.isf(α, 2)` for 2-D ellipses | Same distinction, computed by a tested C++ χ² quantile |

### Mathematical review of the reference code

I checked every analytic Jacobian entry by hand (and later by finite differences in C++
tests). **The 12-state dynamics and Jacobian in `model.py` are correct** for ZYX Euler
angles, thrust along body x, and a uniform sphere: the thrust direction
`[cψcθ, sψcθ, −sθ]`, the Euler-rate kinematics, the gravity-gradient block
`−μ/r³ I + 3μ r rᵀ/r⁵` and all orientation partials match. The `orbital_ekf.py` Joseph
update and per-coordinate χ² bounds are also correct. Points that the new implementation
handles differently (none of them is a mistake in the user's derivation of the physics):

1. **`integrator.rk4` (not used by the EKF)** evaluates `k_4 = f(x + T k_3 / 2)`; classical
   RK4 needs `f(x + T k_3)`. The function actually used, `rk_four`, is correct. Argument
   order also differs between the two (`(f, x, T, u)` vs `(f, x, u, T)`). C++ has a single
   RK4 with one argument order.
2. **`euler_int` docstring** says "Euler (trapezoidal)" but implements forward Euler
   (trapezoidal would average two slopes). C++ names it `euler_int` and documents it as
   forward Euler.
3. **Discrete transition matrix** `F = I + T·A` is a first-order approximation that is not
   the Jacobian of the RK4 step the filter actually uses for the mean. It is accurate for
   `T = 0.01 s` but degrades for orbit-determination step sizes (10 s+). C++ integrates
   the variational equations with the *same* RK4 stages, which gives exactly the Jacobian
   of the discrete RK4 map (verified against finite differences in tests).
4. **Process noise** `L Q Lᵀ` with `L = T·G` treats `Q` as a per-sample input variance, so
   the covariance growth depends on the chosen step size. C++ separates (a) a continuous
   white-noise PSD (units stated per channel) integrated as
   `Q_d = ∫ Φ G Q_c Gᵀ Φᵀ ds`, and (b) a zero-order-hold control-telemetry noise
   `Γ Σ_u Γᵀ` with `Γ = ∫ Φ B ds` — the latter is the exact generalisation of the
   reference model.
5. **Explicit inverse** `inv(H P Hᵀ + R)`: C++ uses an LDLᵀ solve.
6. **Variable shadowing**: in `orbital_ekf.py`, `R` is both the spacecraft radius (global)
   and the measurement covariance (argument), and the Joseph term reads the global
   `R_hat` rather than the argument. The values coincide in that script, so results are
   unaffected, but C++ uses distinct names (`radius`, `R_assumed`).
7. `measurement_range_sensor` docstring mentions a 2-D robot, but the code is 3-D; the
   C++ ground-station sensor is a separate, fully 3-D implementation.
8. `graphics.py`, `DiffDrive` and the EKF skeleton credit Joshua A. Marshall's
   `agv-examples`. The C++ code is a new implementation; this attribution is repeated in
   the README.

The spelling `Satallite_Orbiter` is kept in docs where the Python class is cited and
`Satellite` is used in new code.

---

## Entry 2 — Toolchain setup

**Found on the machine:** Apple Clang 14.0.3 (C++20 capable), GNU Make 3.81, Node 26.4.0,
npm 11.17, Homebrew. **Missing:** CMake, Ninja, Eigen, Emscripten.

Decisions:

- **CMake/Ninja**: Homebrew had no bottle for macOS 13 (it would compile CMake from source),
  so the official Kitware wheels were installed into an isolated virtualenv
  `orbital-simulator/.tools/venv` (`cmake==3.31.6`, `ninja==1.11.1.4`). This avoids
  touching the user's conda environment. CI uses the runners' own CMake.
- **Eigen 3.4.0, nlohmann/json 3.11.3, doctest 2.4.11**: pulled with CMake `FetchContent`
  using pinned URLs **and SHA-256 hashes** (reproducible, works the same for native and
  WebAssembly builds). Eigen 3.4.0 is chosen over Homebrew's Eigen 5 for maturity and
  Emscripten compatibility.
- **Emscripten 4.0.10** installed with emsdk into `orbital-simulator/.tools/emsdk`
  (git-ignored). Result: `emcc ... 4.0.10 (b7dc6e5747...)`, sanity checks passed.

Hashes recorded:

```
eigen-3.4.0.tar.gz   8586084f71f9bde545ee7fa6d00288b264a2b7ac3607b974e54d13e7162c1c72
json.tar.xz (3.11.3) d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d
doctest-2.4.11       632ed2c05a7f53fa961381497bf8069093f0d6628c5f26286161fbd32a560186
```

---

## Entry 3 — Architecture contract (before implementation)

Full text lives in `docs/ARCHITECTURE.md` and `docs/MATH_AND_UNITS.md`; the binding
decisions are:

- **Frames**: ECI (Earth-centred inertial, z = Earth spin axis, x = vernal-equinox direction
  at the scenario epoch, treated as fixed); ECEF obtained by a rotation about z by
  `θ_g(t) = θ_g0 + ω_E t`; topocentric ENU at ground stations; RTN (radial, transverse,
  normal) for maneuvers and error reporting; LVLH/Hill frame for the linear CW lab;
  body frame with ZYX Euler angles (body → ECI: `C = R_z(ψ) R_y(θ) R_x(φ)`).
- **States**: `orbit6 = [r_ECI, v_ECI]`, `rigid12 = [r, v, φ θ ψ, ω_body]`,
  `cw6 = [δr_LVLH, δv_LVLH]` (honestly linear teaching model).
- **Time/event ordering** at each simulation node `t_k`: (1) propagate truth and estimator
  from `t_{k−1}` to `t_k` with controls held constant over the interval (*predict phase*);
  (2) apply impulsive maneuvers scheduled at `t_k` (truth gets the executed Δv; estimator
  gets the commanded Δv only if the burn is *known*); (3) generate and process
  measurements stamped at `t_k` in sensor-registration order (*update phase*); (4) record
  history and evaluation metrics. Nodes are the union of the output grid, sensor sample
  times, maneuver times and thrust-segment boundaries, so asynchronous sensors are handled
  exactly and RK4 never integrates across a control discontinuity.
- **Truth/estimator separation**: the `Estimator` API has no argument through which truth can
  pass; it receives only the measured controls, measurement samples and known-maneuver
  commands. Truth is used only by the measurement generator and the evaluation layer.
- **Randomness**: counter-based streams `Rng(seed, stream, counter)` (xoshiro256** seeded by
  SplitMix64, Box–Muller normals). Each sensor sample, each control-telemetry sample and
  each particle-filter step draws from its own keyed stream, so switching a sensor or an
  estimator never changes another noise realisation.
- **Registries**: estimators and sensors are created through string-keyed registries; adding a
  type is one class plus one registration line.

---

## Entry 4 — Disk-space incident

The first CMake configure failed while extracting Eigen: the data volume was full (42 MB
free). The machine was already nearly full; emsdk (1.6 GB) pushed it over. I removed only
files I had created (partial build tree, scratch downloads) and **asked the user** before
touching anything else. With their approval I ran `pip cache purge` and `brew cleanup -s`
(download caches only), which freed ~5 GB. To stay lean, browser smoke tests use the
installed Google Chrome (`channel: "chrome"`) rather than downloading Playwright browsers.

## Entry 5 — Milestone 1+2: native physics, sensors and all four estimators

Implemented in `core/` (C++20, Eigen 3.4, nlohmann/json):

- `dynamics/`: `ForceModel` (+ `PointMassGravity`), `DynamicsModel` interface, `OrbitalDynamics`
  (orbit6), `RigidSpacecraftDynamics` (rigid12, from model.py, general diagonal inertia),
  `ClohessyWiltshireDynamics` (cw6, the honestly linear lab).
- `integrators/`: `rk_four`, `euler_int`, `propagate`, `propagate_variational` (state, Φ, Γ, Q_d
  in one augmented RK4).
- `frames/`: Earth rotation, ENU, RTN, Kepler conversions; ZYX Euler/DCM/quaternion helpers.
- `sensors/`: `MeasurementModel` (what an estimator may see) and `Sensor` (adds truth-side
  simulation); GNSS position, GNSS PV, gyro (+ optional true bias), star tracker (quaternion-
  style noise reported as Euler angles), ground station range/az/el and range-only; registry.
- `estimators/`: EKF, UKF, bootstrap PF, linear KF (reference / frozen), covariance utilities,
  registry.
- `simulation/`: scenario schema/parser, control model (commanded/actual/measured), the node-
  based `Simulation` with actions, replay log and history hash.
- `diagnostics/`: χ² functions, confidence ellipsoids, local observability, run metrics.
- `apps/osim_cli`: headless runner (`--check-all`, `--estimator`, `--csv`, `--observability`).

Design decisions made while implementing:

- **`MeasurementModel` split from `Sensor`.** Estimators receive `const MeasurementModel&`,
  which has no `simulate()` and no `R_true`. Truth separation is therefore enforced by the
  type system, and a test re-filters the logged measurements with a fresh EKF and reproduces
  the run bit-for-bit (the estimate is a function of measurements and controls only).
- **Truth trajectory independent of sensor toggles.** Every sensor's sample times are nodes
  whether or not it is enabled, so toggling a sensor never changes RK4 sub-step boundaries.
- **Showdown redesign.** The first draft gave EKF ≡ UKF to 4 digits because a linear GNSS fix
  at t = 0 removed all nonlinearity. The final scenario delays tracking by 7 minutes after a
  20 km / 15 m/s initial error, so the uncertainty bends before the first fix.

Particle-filter problems found and fixed (each now counted and reported in the summary):

1. Roughening used the covariance of the *duplicated* particles after resampling → near-zero
   kernel → impoverishment. Fixed to use the weighted posterior covariance from *before*
   resampling (regularised PF, Musso et al. 2001).
2. When ESS < 2n + 1 the survivors span a lower-dimensional subspace (NEES ~ 10¹¹ even though
   per-axis σ looked fine). Now the kernel falls back to the Gaussian-approximation posterior
   with bandwidth 1 ("degeneracy fallback").
3. Collapse recovery re-seeded from a too-tight prior; the prior is now inflated by
   max(1, NIS/m) before the Gaussian update.

Test failures investigated (not just loosened):

- STM vs finite differences: discrepancy shrank as the FD step *grew* → FD round-off on 7×10⁶ m
  positions, not a Jacobian error. Step raised to 10 m; max |ΔΦ| < 10⁻⁶.
- Q_d vs Van Loan: 4.8×10⁻⁵ relative at T = 10 s, shrinking with T. Cause: Q_d's leading term
  is O(T³) while RK4's local error is O(T⁵), so the relative error is O((nT)²). Documented
  in VALIDATION.md; negligible for a tuning matrix.
- "Roll unobservable during thrust" was *wrong physics in the test*: with body rates, roll
  couples into pitch/yaw through θ̇ = cos φ q − sin φ r. The test now uses zero rates/torques.
- The LKF cannot reach cm accuracy from a 2.7 km reference error (second-order terms); its
  noiseless-convergence bound is 1 m and that limitation is the teaching point.
- Node numbering skipped index 1 because an earlier scripted edit had silently not applied;
  caught by the re-filter test and fixed with direct edits.

Commands and results:

```
cmake --preset native && cmake --build --preset native     # no warnings (-Wall -Wextra -Wpedantic -Wshadow -Wconversion)
ctest --preset native -j4                                   # 100% tests passed, 0 failed out of 10
                                                            # 3 731 doctest assertions
build/native/core/osim_cli --check-all scenarios            # 12/12 scenarios finite
```

Showdown (same seed, same data):

| Estimator | pos RMS tail (m) | ANEES/n | dynamics evals |
|---|---|---|---|
| EKF | 9.4 | 1.53 | 1 200 |
| UKF | 10.1 | 0.57 | 16 800 |
| PF (1000) | 14.3 | 0.54 | 1 201 200 |
| Linearised KF | 2 102 | 56 785 | 1 200 |

---

## Entry 6 — Milestone 3: WebAssembly bindings and the browser contract

- `core/bindings/wasm_bindings.cpp` (embind): one `Simulation` class, never throws into JS;
  JSON for metadata/summaries/diagnostics, packed `Float64Array` for history and innovations
  with the layout published in `meta.layout`. Link flags: `MODULARIZE`, `EXPORT_ES6`,
  `ENVIRONMENT=web,worker,node`, memory growth, `-O3`.
- `scripts/wasm_integration_test.mjs` runs every scenario in WebAssembly (in irregular
  97-node chunks) and compares with the native CLI.
- Result: `osim.wasm` 815 KB. All 12 scenarios pass; position-RMS agreement ≤ 7.8×10⁻¹⁰
  relative. **Hashes differ** between native and WASM: Emscripten's musl libm and Apple's
  libm differ in the last bit of `log/sin/cos` (Box–Muller) and trigonometry. Decision:
  document it; determinism is guaranteed *within a build* (which is what replay needs).

## Entry 7 — Milestone 4: frontend, lesson engine, replay

- Vite 5 + React 18 + TypeScript 5.6 + Tailwind 3, react-three-fiber (no drei), uPlot,
  react-markdown + KaTeX, zod. Exact versions in `package.json`/`package-lock.json`.
- `sim/worker.ts` owns the WASM simulation; `sim/client.ts` serialises requests (so the
  simulation sees actions in a deterministic order); `sim/useMission.ts` holds the session,
  playback loop (decides only *how far* to advance), rule engine, objectives, assistant
  messages, save/load replay.
- Lessons: `lessons/schema.ts` (zod), `lessons/engine.ts` (condition DSL, `RuleEngine`,
  `ObjectiveTracker`), `lessons/content.ts` (loads `content/` and cross-checks scenarios,
  dialogue lines, concepts, unlocks). Content: 7 missions, 19 global rules, 35 dialogue
  lines, 18 concept cards (3 debriefs and 1 concept intentionally marked as placeholders).
- Issue found: zod's `discriminatedUnion` rejects refined members → refinement moved to
  `superRefine` on the union.
- Tests: Vitest 23/23 (content validation, triggers, scoring, covariance editor, 3×3 eigen,
  real WASM under Node incl. replay determinism).

## Entry 8 — Milestone 5/6: browser verification, robustness and refinement

Playwright with the installed Chrome (no browser download) found two real problems:

1. **No WebGL → blank page.** This machine's headless Chrome has no GPU; three.js threw while
   creating the context and React unmounted everything. Fixes: WebGL detection with a 2-D
   orbit-plane fallback (χ²₂ ellipse — the right scale for a 2-D marginal), an error
   boundary around the 3-D view, and a silent `dispose()` (outstanding worker requests are
   dropped rather than rejected into nobody's hands).
2. **Main thread starved with software WebGL.** r3f's default continuous render loop under
   SwiftShader gave 2.2 s frames even when idle. Switched to `frameloop="demand"` (render on
   simulation updates, camera changes and while damping settles) — better on real hardware
   too. CPU-rasterised WebGL here is still too slow for interaction tests, so Playwright has
   two projects: `app` (3-D APIs disabled → 2-D path, all interaction tests) and `webgl`
   (SwiftShader, proves the 3-D view renders). Interactive 3-D frame rate on a GPU could not
   be measured on this machine.

Other refinements:

- Text accuracy: the Showdown briefing said "nobody tracks you for 15 minutes"; the core
  shows the first station sample at t = 290 s. Text corrected in lesson and scenario.
- Bundle split (three / markdown / charts) — no chunk over the warning limit.
- Requirements re-check added: runtime sensor cadence (`setSensorPeriod`), sandbox
  ground-station placement and a validated scenario-JSON editor (restores the previous
  scenario if the core rejects an edit), torque inputs for rigid-body thrust arcs, and
  assistant hand-off/tip rules.
- Sensor noise is now keyed by **sample time (ms)** instead of sample index, so a cadence
  change can never reuse earlier noise draws.
- That changed the noise realisation and exposed a fragile metric: two "consistent" verdicts
  flipped. Investigation: one run's NEES values are strongly autocorrelated; across six seeds
  a consistent EKF on First Fix gives ANEES/n from 0.34 to 2.1, while ANIS (nearly white) stays
  0.84–1.05 and the 40-run Monte-Carlo ANEES/n is 1.14. Decision: verdict band [1/3, 3]; the
  calibration score has a dead band [0.5, 2] and decays symmetrically outside, so tiny
  covariances still never win. Documented in MATH_AND_UNITS.md §7.
- The Monte-Carlo NEES test uses 99.9% bounds so platform-dependent noise realisations
  (different libm) don't cause ~1% false alarms in CI.

Commands and results at this point:

```
ctest --preset native -j4                       # 10/10 passed (70 cases, 3 751 assertions)
ctest --preset native-debug -j4                 # 10/10 passed under ASan+UBSan (436 s)
node scripts/wasm_integration_test.mjs          # 12/12 passed; ≤ 7.8e-10 relative vs native
cd web && npm run lint && npm run typecheck     # 0 errors
npm test                                        # 23/23 passed
npm run build                                   # ok
npx playwright test                             # 7/7 passed (app + webgl projects)
```

## Entry 9 — CI and documentation

- `.github/workflows/orbital-simulator-ci.yml` at the workspace root (there was no `.github`
  before): native (Ubuntu + macOS, CTest labels `unit` and `regression`), sanitizers, WASM
  build + comparison with the Linux CLI artifact, frontend lint/type/unit/build/Playwright
  (Chromium). `permissions: contents: read`; no deploy. Validated as YAML locally; it has not
  run on GitHub because `EduPhysics/` is not a Git repository yet.
- Documentation written: README, REQUIREMENTS, ARCHITECTURE (incl. scenario schema),
  MATH_AND_UNITS, LESSON_AUTHORING, VALIDATION, EXTENDING, this journal and the
  implementation report.

## Entry 10 — Final verification and report

- Sanitizer build re-run on the final C++ code (after the cadence/noise-keying change):
  CTest log shows 10 × "Test Passed", no failures, no ASan/UBSan output (440 s).
- WebAssembly rebuilt after the last C++ change and re-copied into the app; WASM ↔ native
  12/12, Vitest 23/23 and Playwright 7/7 re-run against it.
- `docs/IMPLEMENTATION_REPORT.md` written; `docs/IMPLEMENTATION_REPORT.pdf` generated with
  `web/scripts/report-pdf.mjs` (react-markdown + remark-gfm + KaTeX → headless Chrome PDF;
  `remark-gfm@4.0.0` added as a dev dependency for tables). Pandoc was not available.
- Verified that `Python_Orbit_determination/` files keep their original modification times
  (all before this session) — nothing there was touched.
- Not done in this session: running CI on GitHub (no repository), measuring 3-D frame rate on
  a GPU, Firefox/Safari tests.
