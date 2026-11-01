# Mathematics, frames and units

Everything inside the C++ core is **SI** (m, s, kg, rad, N, N·m) and **double precision**.
Units are converted only for display (km for positions in state plots, degrees for angles).

## 1. Reference frames and time

| Frame | Definition | Used for |
|---|---|---|
| **ECI** | Earth-centred inertial; z = spin axis; x fixed at the scenario epoch (treated as an inertial "vernal equinox" direction) | integration, states |
| **ECEF** | ECI rotated about z by θ_g(t) = θ_g0 + ω_E t, ω_E = 7.2921150×10⁻⁵ rad/s | ground stations |
| **ENU** | East–North–Up at a station on a sphere of radius R_E = 6371 km | azimuth/elevation |
| **RTN** | R = r̂, N = (r×v)/‖r×v‖, T = N×R | maneuvers, error/σ reporting |
| **LVLH (CW)** | chief-centred: x radial, y along-track, z cross-track | linear lab |
| **Body** | ZYX Euler angles e = [φ, θ, ψ]; C_bi = R_z(ψ) R_y(θ) R_x(φ) maps body → ECI | rigid12 |

Time `t` is seconds since the scenario epoch (an ISO-8601 string kept for information).
Precession, nutation, polar motion and Earth oblateness are neglected (documented limitation).

## 2. State definitions

| Model | State | Control u | Noise w |
|---|---|---|---|
| `orbit6` | r (m), v (m/s) in ECI | thrust acceleration in ECI (m/s²) | acceleration, PSD in m²/s³ |
| `rigid12` | r, v, φ θ ψ (rad), ω_body (rad/s) | T (N, along body x), τ (N·m) | [a_w (ECI), α_w (body)], PSD m²/s³ and rad²/s³ |
| `cw6` | δr, δv in LVLH | acceleration in LVLH | acceleration PSD |

## 3. Dynamics

**Two-body (all orbit models).** a = −μ r / r³ with μ = 3.986004418×10¹⁴ m³/s².
Jacobian (gravity gradient): ∂a/∂r = −μ/r³ I + 3μ r rᵀ / r⁵, ∂a/∂v = 0.

**Composable forces.** `OrbitalDynamics` and `RigidSpacecraftDynamics` sum any list of
`ForceModel`s, each returning a(t, r, v), ∂a/∂r, ∂a/∂v.

**Rigid body (from `model.py`).**

```
ṙ = v
v̇ = Σ aᵢ + (T/m) [cψ cθ, sψ cθ, −sθ]ᵀ + a_w
ė = W(φ,θ) ω,  W = [[1, sφ tθ, cφ tθ], [0, cφ, −sφ], [0, sφ/cθ, cφ/cθ]]
ω̇ = I⁻¹ (τ − ω × Iω) + α_w
```

With the default uniform sphere I = 0.4 m R² (all axes), ω × Iω = 0 and ω̇ = τ/I exactly as
in the Python model. Partials of the gyroscopic term, −I⁻¹([ω×]I − [(Iω)×]), are included
for general diagonal inertia. Every analytic Jacobian is checked against finite differences.

**Euler singularity guardrails.** At θ = ±90°, cos θ = 0 and roll/yaw become
indistinguishable. The code (i) clamps |cos θ| ≥ 10⁻⁶ with its sign kept, so f and A stay
finite; (ii) normalises θ beyond ±90° to the equivalent (φ+π, π−θ, ψ+π); (iii) wraps angle
differences into (−π, π]; (iv) reports a warning within 2.6° of the singularity. Migration
path: replace e by a unit quaternion q (4 states, 3 error states), with q̇ = ½ q ⊗ [0, ω];
`attitude.hpp` already provides Euler ↔ DCM ↔ quaternion conversions, and the estimator
interface already routes all additions/differences through `normalize`/`state_difference`.

**Clohessy–Wiltshire.** δẍ = 3n²δx + 2nδẏ + u_x, δÿ = −2nδẋ + u_y, δz̈ = −n²δz + u_z with
n = √(μ/a³) of the chief. Linear, so the standard KF is exact here.

## 4. Integration and discretisation

**RK4** with zero-order-hold input over each step T:
k₁ = f(x), k₂ = f(x + T k₁/2), k₃ = f(x + T k₂/2), k₄ = f(x + T k₃), x⁺ = x + T/6 (k₁ + 2k₂ + 2k₃ + k₄).
An interval Δt is split into ⌈Δt / maxStep⌉ equal sub-steps.

**Variational equations** integrated with the same stages:

```
Φ̇ = A Φ                      Φ(0) = I
Γ̇ = A Γ + B                  Γ(0) = 0      (Γ = ∫ Φ(t,s) B ds)
Q̇w = A Qw + Qw Aᵀ + G Q_c Gᵀ  Qw(0) = 0
```

Because each variational stage is the derivative of the corresponding state stage, Φ is the
**exact Jacobian of the discrete RK4 map** — consistent with how the EKF propagates its mean.
The Python reference used F = I + T A, which is first order.

**Process noise.** Q_d = Qw + Γ Σ_u Γᵀ.
- Q_c is a power spectral density, so Q_d scales correctly with elapsed time: for small Δt,
  the velocity variance grows like q Δt and position like q Δt³/3 (tested).
- Σ_u is the per-step control-telemetry covariance held over the interval, which is exactly
  the reference model L Q Lᵀ with L = T G for small T, generalised to any step.
- RK4 integrates Q_d with relative error O((nΔt)²) per step (its leading term is O(Δt³) while
  RK4's local error is O(Δt⁵)): 5×10⁻⁵ for a 10 s LEO step, negligible for a tuning matrix.

## 5. Measurements

| Sensor | z | H | Notes |
|---|---|---|---|
| GNSS position | r + v | [I 0 …] | navigation fix, not pseudoranges |
| GNSS PV | [r; v] + v | [I₆ 0 …] | |
| Gyro | ω + b_true + v | [0 … I] | true bias not estimated (mismatch lesson) |
| Star tracker | Euler(C Exp(δθ)), δθ ~ N(0, R_body) | [0 I 0] | filter uses R_euler = W R Wᵀ |
| Ground range/az/el | [‖ρ‖, atan2(E,N), atan2(U, √(E²+N²))] | analytic (below) | elevation mask, zenith rejected |

Ground station: ρ = r − R_z(θ_g) r_s,ECEF, [E N U]ᵀ = M ρ with M = (ENU basis) R_z(−θ_g).
∂ρ/∂r = ρ̂ᵀ M, ∂A/∂[E N U] = [N, −E, 0]/(E²+N²),
∂El/∂[E N U] = [−EU/(ρ²h), −NU/(ρ²h), h/ρ²] with h = √(E²+N²); chain with M.

Residuals wrap angle components into (−π, π].

## 6. Estimators

**EKF.** Predict: x⁻ = RK4(x⁺), P⁻ = Φ P⁺ Φᵀ + Q_d. Update: ν = z ⊖ h(x⁻),
S = H P⁻ Hᵀ + R, Kᵀ = S⁻¹ H P⁻ (LDLᵀ solve), x⁺ = x⁻ + Kν,
P⁺ = (I − KH) P⁻ (I − KH)ᵀ + K R Kᵀ (Joseph), then symmetrise; eigenvalue clipping only if
rounding makes P indefinite (counted as a "PSD repair").

**UKF.** λ = α²(n+κ) − n; σ-points x ± columns of chol((n+λ)P);
W_m0 = λ/(n+λ), W_c0 = W_m0 + 1 − α² + β, W_i = 1/(2(n+λ)). Defaults α = 1, β = 2, κ = 0
(λ = 0, non-negative mean weights, points at ±√n σ). Additive Q_d from the variational
equations at the mean. Angle means are taken relative to the central point. Update
P⁺ = P⁻ − K S Kᵀ with symmetrisation and PSD guard; Cholesky falls back to jitter.

**Particle filter.** Bootstrap SIR: propagate each particle with RK4 + N(0, Q_d);
log-weights += −½ νᵢᵀ R⁻¹ νᵢ; log-sum-exp normalisation; ESS = 1/Σwᵢ². Resample
(systematic) when ESS < 0.5 N, then roughen with kernel h = (4/(N(n+2)))^{1/(n+4)} using
the *pre-resampling* weighted covariance (regularised PF). Safeguards (all counted):
(a) if ESS < 2n+1 the kernel is the Gaussian-approximation posterior with h = 1 (the
weighted covariance is rank deficient); (b) if no particle is within the χ²_m(1−10⁻⁶) gate,
the prior is inflated by max(1, NIS/m) and the cloud is re-seeded from a Gaussian update.
NIS for the PF uses the weighted predicted-measurement covariance + R.

**Linear KF.** *Reference:* propagate a nominal x_ref from the initial estimate, estimate
δx with δx⁻ = Φ_ref δx⁺ and z ≈ h(x_ref) + H(x_ref) δx; never re-linearised. *Frozen:*
ẋ ≈ f(x₀) + A₀(x − x₀) + B₀u, fixed forever; only linear sensors accepted. For `cw6` both
are the exact KF.

**Known maneuver.** x_v += Δv_cmd (computed from the estimate's own RTN frame),
P_vv += diag(σ_exec²).

## 7. Statistics and confidence regions

χ² CDF via the regularised incomplete gamma function (series / Lentz continued fraction),
quantiles by bracketed bisection; checked against table values (e.g. χ²₃(0.99) = 11.3449).

- **Per-coordinate band** (error plots): ±√(χ²₁(p) Pᵢᵢ); 99% → ±2.58σ.
- **Joint region** (3-D ellipsoid): eᵀ P_rr⁻¹ e ≤ χ²₃(p); semi-axes √(χ²₃(p) λᵢ) along P's
  eigenvectors; 99% → 3.37σ. Using χ²₁ for a 3-D ellipsoid would hold only ≈ 91.6%.
- **2-D fallback ellipse**: χ²₂(p) for the x–y marginal.
- **NIS** = νᵀ S⁻¹ ν ~ χ²_m; **NEES** = eᵀ P⁻¹ e ~ χ²_n (needs truth). Time averages are
  serially correlated, so their χ² bounds are optimistic; the C++ suite also runs an
  independent 40-run Monte-Carlo NEES test.

Calibration verdict (summary): ANEES/n < 1/3 under-confident, 1/3–3 consistent, > 3
over-confident. The band is wide on purpose: within one run successive NEES values are
strongly correlated, and a consistent EKF's single-run ratio ranges from 0.34 to 2.1
across seeds on First Fix (the mis-tuned teaching cases sit at ≈27 and ≈10⁵).
Calibration score = 100·exp(−max(0, |ln(ANEES/n)| − ln 2)): 100 inside [0.5, 2],
decaying identically for over- and under-confidence — a tiny covariance never scores.

## 8. Observability diagnostic

Over a window [t₀, t₀+W] along the **estimated** trajectory with planned controls:
O = stack(R_i^{-1/2} H_i Φ(t_i, t₀)) · S, with S = diag(1 km, 1 m/s, 0.01 rad, 10⁻⁴ rad/s).
Numerical rank uses σ_i > 10⁻⁹ σ_max; condition = σ_max/σ_rank; null-space directions and
"weak" directions (σ_i < 10⁻⁶ σ_max) are reported with their largest components; best-case
σ = √diag((OᵀO)⁺) (information only, no prior). This is local and linearised — not a global
observability guarantee.

## 9. Future force models (not implemented)

- **J2**: a = −(3/2) J2 μ R_E²/r⁵ [x(1 − 5z²/r²), y(1 − 5z²/r²), z(3 − 5z²/r²)], partials analytic.
- **Drag**: a = −½ ρ(h) (C_D A/m) ‖v_rel‖ v_rel with v_rel = v − ω_E × r; depends on v.
- **SRP**: a = −P_⊙ C_R (A/m) ŝ (with shadow function).
- **Third body (Moon/Sun) in an Earth-centred frame**:
  a = μ_b [ (r_b − r)/‖r_b − r‖³ − r_b/‖r_b‖³ ].
  The second term is the **indirect acceleration** of the Earth itself toward the body:
  because ECI is centred on an accelerating Earth, only the *difference* (tidal) acceleration
  acts on the spacecraft relative to Earth. This is a perturbation of two-body motion with
  a prescribed body ephemeris r_b(t) — it is *not* the circular restricted three-body
  problem, which uses a rotating barycentric frame and two primaries of comparable mass.

Each fits the `ForceModel` interface without changing estimators or the UI (see EXTENDING.md).
