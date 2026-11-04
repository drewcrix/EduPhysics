# Validation

The guiding rule: **never validate an algorithm only against another copy of itself.**
Each numerical component is checked against an independent reference — an analytic
solution, a closed form, finite differences, a published table, a conservation law, or a
statistical property — and the shipped scenarios are checked for physically meaningful
behaviour.

## How to run

```bash
cmake --preset native && cmake --build --preset native && ctest --preset native   # C++ (10 targets)
cmake --preset native-debug && cmake --build --preset native-debug && ctest --preset native-debug  # ASan/UBSan
node scripts/wasm_integration_test.mjs                                             # WASM vs native
cd web && npm test && npx playwright test                                          # frontend + browser
```

## Results of this release (macOS 13.1, Apple Clang 14.0.3)

| Suite | Result |
|---|---|
| CTest (Release): 9 doctest suites + CLI over every scenario | **10/10 passed**, 70 test cases, 3 751 assertions, ~8 s |
| CTest (Debug, ASan + UBSan) | see the final status in IMPLEMENTATION_REPORT.md §6 |
| WebAssembly vs native, all 12 scenarios | **12/12 passed**, max relative difference in position RMS 7.8×10⁻¹⁰ (hashes differ: libm) |
| Vitest (engine, content, scoring, covariance, eigen, WASM) | **23/23 passed** |
| Playwright (Chrome): 6 app tests + 1 WebGL test | **7/7 passed** |
| ESLint / TypeScript | 0 errors / 0 errors |

## C++ test inventory

### Dynamics (`test_dynamics.cpp`)
| Check | Reference |
|---|---|
| orbit6 Jacobian, 20 random LEO states | central finite differences (rtol 10⁻⁶) |
| rigid12 Jacobian and B with **non-isotropic** inertia and thrust, 30 states | finite differences (rtol 10⁻⁵) |
| rigid12 f equals `Satallite_Orbiter.f` | literal re-implementation of model.py equations (10⁻¹³) |
| CW Jacobian | finite differences |
| Gimbal lock: f, A finite at θ = 90°, warning raised | guardrail spec |
| normalize() past ±90° keeps the same DCM; angle differences wrap | DCM equality |
| Dimensions/labels/units consistent for all models | — |
| Invalid μ, mass, mean motion rejected | — |

### Integrators (`test_integrators.cpp`)
| Check | Reference | Result |
|---|---|---|
| Circular orbit at 600 s, 1800 s, one period (h = 10 s) | analytic r(t) = a[cos nt, sin nt, 0] | < 5 cm |
| Elliptical orbit (e = 0.2) at 1000/4000/9000 s | independent Kepler-equation solver | < 0.5 m |
| Energy and angular momentum over 5 orbits (e = 0.2) | conservation laws | relative drift < 10⁻⁹ |
| RK4 step halving 40 → 20 s | 2⁴ = 16 | **16.52** |
| Euler step halving 0.5 → 0.25 s | 2 | **1.998** |
| Φ from variational equations vs FD of the discrete RK4 map | finite differences | max |ΔΦ| < 10⁻⁶; I + TA is ≥ 10× worse |
| Φ for CW over 900 s | closed-form CW STM | rtol 10⁻⁸ |
| Q_d for CW at 10/100/600 s | Van Loan matrix exponential | rel. < 10⁻⁴ (see note) |
| Q_d elapsed-time scaling | q Δt and q Δt³/3 for a double integrator | ratios 2.000 and 8.000 |
| Control-noise term vs reference L Q Lᵀ | Python model | agrees |
| Sub-stepping = repeated RK4 steps | bitwise | exact |

*Note on Q_d:* RK4's local error is O(Δt⁵) but Q_d's leading term is O(Δt³), so the relative
error is O((nΔt)²) ≈ 5×10⁻⁵ for a 10 s step in LEO (it shrinks with more sub-steps). That is
irrelevant for a tuning matrix; it is documented rather than hidden by a loose tolerance.

### Frames (`test_frames.cpp`)
Kepler ↔ Cartesian round trip and vis-viva; RTN/ENU orthonormal and right-handed;
ECEF after one sidereal day = identity; Euler ↔ DCM ↔ quaternion round trips; thrust axis
equals C e₁; Euler-rate kinematics agree with the DCM derivative (finite difference).

### Sensors (`test_sensors.cpp`)
Ground-station H (range/az/el and range-only) vs finite differences; overhead geometry
(range = altitude, El = 90°, zenith rejected, far side invisible, due north → A = 0);
40 000-sample noise mean/covariance vs R_true (correlated R); star-tracker Euler covariance
vs W R Wᵀ; sample times with phase; outage boundaries; registry validation messages;
**dropout timing**: exactly 21 outage statuses for a 600–800 s outage at 10 s cadence;
gyro on orbit6 reported as unsupported with an explanation, never fabricated.

### Covariance (`test_covariance.cpp`)
Validation messages (symmetry, |ρ| > 1, negative diagonal, PD vs PSD, NaN, size);
Joseph = standard form for the optimal gain and PSD for a 3× gain; PSD repair and safe
Cholesky; **symmetry < 10⁻¹² and min eigenvalue > −10⁻¹² at every node for EKF, UKF, PF and KF on
three scenarios (including rigid12)**; EKF covariance convergence (trace stops shrinking);
linear KF on CW converges to the **independently iterated discrete Riccati fixed point**.

### Estimators (`test_estimators.cpp`)
| Check | Result |
|---|---|
| Noiseless GNSS (σ = 1 mm), 2.7 km / 2.7 m/s initial error | EKF, UKF < 1 cm and < 0.1 mm/s; linearised KF < 1 m (limited by its reference — the teaching point); PF < 5 m |
| CW linear model: KF, EKF, UKF agree | ‖Δx‖ < 10⁻⁶, P rel. < 10⁻⁶ |
| UKF weights sum to 1; σ-points reproduce mean and covariance; invalid α rejected | — |
| PF reproducible per seed; different seed → different run | hash equality / inequality |
| **Monte-Carlo NEES**, 40 independent seeds, EKF | ANEES 6.85 ∈ [4.36, 7.97] (99.9% χ² bounds, n = 6) |
| **Truth separation**: re-filtering the logged measurements with a fresh EKF reproduces every node | exact equality |
| Showdown sanity: EKF/UKF/PF tail RMS < 100 m and ANEES/n < 5; linear KF ≥ 5× worse and over-confident; PF ≥ 50× more dynamics evaluations | passes |
| Frozen KF diverges (> 10 km) where the EKF stays < 50 m | passes |
| Frozen KF refuses nonlinear ground-station data, with a reason | passes |

### Simulation (`test_simulation.cpp`)
Replay of an interactive session (sensor toggles, R change, estimator switches EKF→UKF→PF,
Q change, unknown burn) from the action log → identical hash and log; playback chunking
(one call, irregular 37 s chunks, phase-by-phase) → identical hash; truth independent of
sensor toggles and estimator choice; impulse applied after propagation and before same-time
measurements (truth and prior both contain the Δv; prior covariance contains the execution
uncertainty); asynchronous sensor (period 7 s, phase 3 s) processed exactly at its sample
times while the 10 s record grid remains; commanded/actual/measured controls distinct;
finite tangential thrust changes specific energy by the work ∫a·v dt (rel. 10⁻⁴); a mid-run
cadence change produces samples exactly at t + k·period and replays exactly; invalid
scenarios and actions rejected with readable messages and not logged.

### Diagnostics (`test_diagnostics.cpp`)
χ² quantiles vs tables (6.634897, 9.210340, 11.344867, 12.591587, 20.483177) and CDF/quantile
consistency up to 400 dof; P(χ²₃ ≤ χ²₁(0.99)) = 0.9156; ellipsoid axes orthonormal,
right-handed and reconstructing P; observability: one GNSS epoch rank 3 (velocity
unobservable), 60 s window rank 6; rigid12 GNSS-only coasting rank 6 with all attitude
states unobservable, thrust arc raises the rank while roll about the thrust axis stays
unobservable (zero body rates), GNSS + gyro + star tracker rank 12; single range rank 1,
a pass of ranges > 1; no sensors rank 0 with a dead-reckoning note; run summary flags the
Noisy Receiver as over-confident and the retuned one as consistent.

### Regression (`test_regression.cpp`) — physics, not stored outputs
First Fix tail RMS between 0.2 and 5 m with ANIS/dim in [0.8, 1.25]; Tracking Blackout
along-track σ grows > 10× during the outage, drops > 5× after it, and the along-track error
stays inside the per-axis 99% band > 90% of the time; Unexpected Burn NIS mean before the
burn < χ²₃(0.99) and after > χ²₃(0.999), and telling the filter about the burn restores
consistency; Planned Burn consistent; Python reference case (3001 nodes) sub-2 m final
position, < 3° attitude RMS, energy increase from thrust; range+bearing beats range-only;
every scenario × every estimator runs with finite values.

## Frontend tests
- `content.test.ts`: every lesson, rule, dialogue and concept file validates; cross-references
  (scenarios, lines, concepts, unlocks) resolve; the seven missions are present in order and
  each has prediction, interaction, objectives, reasoning and debrief.
- `engine.test.ts`: condition semantics; GNSS-off → outage explainer (once); range-only →
  observability highlight; R ↑ → weighting question; NIS spike → mismatch lesson; metric vs
  event rules; flags; duplicate ids; objective latching; authoring errors reported.
- `covariance.test.ts`: editor validation (symmetry, |ρ| > 1, joint infeasibility, PD/PSD,
  NaN, size), scoring (separate categories; over- and under-confidence both penalised),
  3×3 eigen-decomposition.
- `wasm.test.ts`: real module under Node — packed-record decoding, error reporting without
  exceptions, **replay determinism** and **chunking independence** through the browser API,
  observability rank, ellipsoid k², χ², estimator list.
- Playwright: welcome screen; prediction gate → Predict/Update phase stepping → objective
  → playback → plots; **identical replay hash at 1000× and 300× playback**; showdown runs all
  five contestants; no horizontal scroll at 390 px; keyboard Space play/pause and focus;
  WebGL 3-D view renders without errors (software GL).

## Known gaps in validation
- No comparison against an external orbit-determination package (e.g. GMAT/Orekit); the
  references are analytic/statistical.
- Native vs WebAssembly results are not bit-identical (different libm in Box–Muller and
  trigonometry); they agree to ~10⁻¹¹ relative. Replays are exact within a build.
- The CI workflow has been validated as YAML but has not yet run on GitHub (the folder is not
  a Git repository yet); GCC/Linux builds are therefore untested locally.
- Interactive 3-D frame rate was not measurable on the development machine (no GPU).
