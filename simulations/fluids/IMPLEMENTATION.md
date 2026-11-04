# Airfoil Flow Lab — implementation

The fluids simulator of EduPhysics: viscous, incompressible, two-dimensional flow around NACA airfoils
at low Reynolds numbers, computed offline with a Python Navier–Stokes solver and explored in a React
viewer. This document covers the governing equations, the discretisation, the solver architecture,
boundary conditions, aerodynamic post-processing, validation, the precomputation workflow, the data
format, the frontend data flow, and how to extend the simulator.

**Contents**

1. [Scope: what is computed and what is not](#1-scope-what-is-computed-and-what-is-not)
2. [Layout](#2-layout)
3. [Governing equations](#3-governing-equations)
4. [Discretisation](#4-discretisation)
5. [Boundary conditions](#5-boundary-conditions)
6. [Aerodynamic calculations](#6-aerodynamic-calculations)
7. [Review of the reference scripts](#7-review-of-the-reference-scripts)
8. [Validation](#8-validation)
9. [Precomputation workflow](#9-precomputation-workflow)
10. [Data format](#10-data-format)
11. [Frontend architecture and data flow](#11-frontend-architecture-and-data-flow)
12. [Changing content, adding airfoils and features](#12-changing-content-adding-airfoils-and-features)
13. [Limitations and unsupported combinations](#13-limitations-and-unsupported-combinations)
14. [Tests and continuous integration](#14-tests-and-continuous-integration)

---

## 1. Scope: what is computed and what is not

| Shown in the app | Source | Label in the UI |
|---|---|---|
| Flow fields, surface C<sub>p</sub> and C<sub>f</sub>, C<sub>L</sub>, C<sub>D</sub>, C<sub>m</sub>, force histories, stagnation / separation points, Strouhal numbers | 2D incompressible Navier–Stokes simulation, one run per (airfoil, Re, α) | *Navier–Stokes CFD* |
| Boundary-condition explorer | Separate simulations with altered domains / boundary conditions | *Navier–Stokes CFD* |
| C<sub>L</sub> = 2π(α − α<sub>L=0</sub>), α<sub>L=0</sub>, C<sub>m,c/4</sub>; plain-flap increments; Blasius flat-plate friction and boundary-layer thickness | Closed-form theory (`theory.py`, `physics/theory.ts`) | *Analytical theory* |
| ΔC<sub>l,max</sub> of high-lift devices | Published preliminary-design values (Raymer) | *Empirical (published data)* |
| High-lift device drawings and the lift-curve sketch | Schematic | *Conceptual illustration — not computed* |

Rules that the code enforces:

* **No interpolation between cases.** The sliders offer exactly the (Re, α) combinations present in the
  manifest (`frontend/src/data/selection.ts`); a request for anything else snaps to an existing case.
* **No imposed behaviour.** Lift curves, stall and separation are whatever the simulations produce. A lift
  maximum ("stall") is reported only when the computed points show one (`assessStall` in
  `physics/theory.ts`): the largest mean C<sub>L</sub> must be inside the computed range and the next
  angle must be lower by more than both 0.02 and the unsteady fluctuation of either point.
* **Honest run status.** Every case carries a flow class (§6.6). Unsteady runs show means with their
  oscillation range; runs still drifting at the end are labelled *not converged*.
* **Multi-element high-lift configurations are not simulated** (§13) and say so on the page.

## 2. Layout

```text
simulations/fluids/
├── backend/                     Python package eduphysics_fluids (solver independent of the frontend)
│   ├── pyproject.toml           package, ruff config, console script `eduphysics-fluids`
│   ├── requirements*.txt        pinned versions used to generate data/
│   └── eduphysics_fluids/
│       ├── geometry.py          NACA 4/5-digit sections, Airfoil and Cylinder bodies, polygon tests
│       ├── solver.py            cut-cell MAC projection solver (CutCellSolver)
│       ├── analysis.py          forces, moments, C_p, C_f, wall critical points, unsteady statistics
│       ├── theory.py            thin-airfoil theory, plain flap, Blasius estimates
│       ├── fields.py            uniform-grid resampling, quantisation, field critical points
│       ├── datagen.py           case specs, presets, running, output, manifest
│       ├── validation.py        cylinder benchmark, symmetry check
│       ├── plotting.py          matplotlib figures of generated cases (optional)
│       └── cli.py, __main__.py  command line interface
├── data/                        precomputed dataset (manifest.json, cases/, validation.json)
├── frontend/                    React + Vite + Tailwind viewer (@eduphysics/fluids workspace)
├── tests/                       pytest suite (fast by default, `-m slow` for benchmarks)
├── pytest.ini
└── IMPLEMENTATION.md            this file
```

The user's original scripts in `fluid_flow_simulator/` (repository root) are references only; nothing
imports them except an optional parity test that is skipped when they are absent.

## 3. Governing equations

Constant-density Newtonian fluid, two dimensions, no body forces:

$$\rho\Big(\frac{\partial \mathbf u}{\partial t} + (\mathbf u\cdot\nabla)\mathbf u\Big) = -\nabla p + \mu\nabla^2\mathbf u,\qquad \nabla\cdot\mathbf u = 0 .$$

The code works in units of the chord *c* and free-stream speed *U*<sub>∞</sub>, with the kinematic pressure
*p*/ρ relative to the far field, so the only parameter is Re = *U*<sub>∞</sub>*c*/ν and the viscosity
used by the solver is ν = *U*<sub>∞</sub>*c*/Re. Coefficients:

* C<sub>p</sub> = (p − p<sub>∞</sub>)/(½ρU<sub>∞</sub>²), C<sub>f</sub> = τ<sub>w</sub>/(½ρU<sub>∞</sub>²);
* C<sub>L</sub> = F<sub>y</sub>/(½ρU<sub>∞</sub>²c), C<sub>D</sub> = F<sub>x</sub>/(½ρU<sub>∞</sub>²c) with the free stream along +x;
* C<sub>m</sub> = M/(½ρU<sub>∞</sub>²c²) about the quarter chord, positive nose up.

The angle of attack pitches the airfoil nose up about its leading edge (the free stream stays along +x),
exactly as in the reference solver.

## 4. Discretisation

The discretisation is that of the reference solver `naca0012_solver.py`; §7 lists what was generalised.

### 4.1 Grid

A Cartesian, stretched, staggered (MAC) grid. Edges march outward from the anchor point (the leading
edge) with a local spacing

* in x: `min(h_w + g|x − x_LE|, h_w + g|x − x_TE|, h_c + g·dist(x, [x_min, x_max]))`
* in y: `h_w + g·dist(y, [y_min − 0.02c, y_max + 0.02c])`

where *h*<sub>w</sub> is the wall spacing, *h*<sub>c</sub> the chordwise spacing over the body, and *g* = growth − 1.
The cell size therefore grows linearly with distance, and the number of cells to the far field grows
only logarithmically with the domain size. A last sliver cell is merged into its neighbour.

| Level | h<sub>w</sub> | h<sub>c</sub> | growth | cells (NACA 0012, α = 8°) | use |
|---|---|---|---|---|---|
| coarse | 0.010 | 0.020 | 1.10 | ≈ 17 000 | grid study |
| **medium** | **0.0075** | **0.015** | **1.08** | **≈ 28 000** | **production dataset** |
| fine | 0.005 | 0.010 | 1.05 | ≈ 69 000 | grid study (the reference solver's default) |

Domain: 10c upstream, 20c downstream, ±10c laterally (all levels).

### 4.2 Geometry

* **NACA 4-digit** `MPTT`: camber line *y*<sub>c</sub> = m/p²(2px − x²) for x < p and
  m/(1−p)²((1−2p) + 2px − x²) otherwise.
* **NACA 5-digit** `LPQTT` (standard, Q = 0): *y*<sub>c</sub> = k₁/6 (x³ − 3rx² + r²(3−r)x) for x < r and
  k₁r³/6 (1 − x) otherwise, with (r, k₁) from Abbott & von Doenhoff (P = 3: r = 0.2025, k₁ = 15.957),
  k₁ scaled by C<sub>l,design</sub>/0.3.
* **Thickness** 5t(0.2969√x − 0.1260x − 0.3516x² + 0.2843x³ − 0.1036x⁴): the −0.1036 coefficient closes
  the trailing edge (the original −0.1015 leaves a 0.25%c gap), as in the reference solver.
* Thickness is applied **perpendicular to the camber line** (x<sub>u,l</sub> = x ∓ t sin θ, y<sub>u,l</sub> =
  y<sub>c</sub> ± t cos θ), the original NACA construction, so the upper surface of a cambered section
  extends slightly ahead of x = 0.
* The surface is parameterised by θ ∈ [0, 2π], counter clockwise from the trailing edge, with
  x/c = (1 + cos θ)/2 along the camber line (cosine clustering at both edges).
* **Inside test** (`NacaSection.contains`): every interior point is C(s) + n N(s) for a unique camber
  station s with |n| ≤ t(s), because the camber curvature is far below 1/t. Newton's method finds the
  foot point s where (P − C(s)) is normal to the camber line. It agrees exactly with an independent
  polygon test on 60 000 random points per section (`tests/test_geometry.py`).

Checked properties (tests): maximum thickness at 30% chord; 2412 camber 2% at 40%; 2213 2% at 20%;
23012 1.84% at 15%; leading-edge radius 1.1019t².

### 4.3 Cut cells, faces and control volumes

Every grid line is intersected exactly with the body surface (bracketing on 8193 surface samples, then
Brent's method in θ). Each face is cut into its open (fluid) segments, and each segment is classified:

* **MOMENTUM** — the face centre is in the fluid at least `NEAR_WALL_FRACTION` (0.25) of the cell size
  from the wall: its velocity is an unknown of the momentum equation. A partially cut face carries a
  `flux_factor` that converts the centre velocity into the mean velocity over the open part (linear
  profile through zero at the wall).
* **INTERPOLATED** — the centre is inside or very close to the wall: the velocity follows a linear
  profile from u = 0 at the wall to the next full face (no tiny cut faces with stiff equations).
* **INLET / OUTLET / OPEN / SLIP** — domain boundaries (§5).

Each Cartesian cell is split into one **pressure control volume per connected fluid region**, found by
walking around the cell perimeter (open segments touching at a corner belong together). This handles
cells that the thin trailing edge divides into two separate fluid regions. Tiny "passive" volumes
touched only by interpolated faces never enter a momentum equation; their pressure, needed only for
post-processing, is the weighted average of their neighbours.

**Single-interval guard.** The face bookkeeping assumes that a grid line meets the body in at most one
interval. For concave sections at some angles a line can cross the surface four times; the solver then
raises `GeometryError` rather than producing a wrong mask. None of the four supported sections triggers
it at the computed angles; a test with a non-convex body checks that the guard fires.

### 4.4 Momentum operators

* **Viscous term**: three-point second derivatives on uneven spacing in each direction. Where a grid line
  hits the wall before the next node, the wall (u = 0) is used at its **exact distance**.
* **Advection**: (u·∇)q with second-order upwind differences (three points on uneven spacing) chosen by
  the sign of the local advecting velocity; first-order upwind next to walls and boundaries, where the
  second upwind point does not exist.
* **Transverse velocity** (v at u-faces and u at v-faces): two wall-aware one-dimensional linear
  interpolations that stop at the wall.

All operators depend only on the geometry and grid, so they are assembled once as sparse matrices; one
solver object can run several Reynolds numbers (`CutCellSolver.reset`).

### 4.5 Time integration (projection method)

Each step, with velocities **u**ⁿ and pressure pⁿ:

1. **Predictor** — explicit advection, implicit (backward Euler) diffusion, old pressure gradient:
   (I − Δt ν L) **u**\* = **u**ⁿ + Δt(ν L<sub>bc</sub> − A(**u**ⁿ)**u**ⁿ − G pⁿ).
2. **Outlet** — update the outlet velocity and pressure (§5).
3. **Projection** — solve D G φ = D **u**\*/Δt (with the outlet pressure increment as a known boundary
   gradient), then **u**ⁿ⁺¹ = **u**\* − Δt G φ and pⁿ⁺¹ = pⁿ + φ (incremental pressure correction).
   D is the discrete divergence (open face lengths / cell area) and G the face-normal gradient. The
   Poisson matrix DG is fixed, so it is LU-factorised once (SuperLU, MMD ordering); after every step the
   solver asserts max |D**u**| < 10⁻⁹, i.e. the velocity is divergence free to round-off.

**Stability and the time step.** Forward Euler combined with second-order upwinding has no numerical
diffusion of its own. For linear advection with the second-order upwind symbol
λ(θ) = (a/2h)(3 − 4e<sup>−iθ</sup> + e<sup>−2iθ</sup>) one finds, for small wavenumbers,
|G|² ≈ 1 + c²θ² − (ν Δt/h²)·2θ² with c = aΔt/h: Euler's anti-diffusion u²Δt/2 must be outweighed by the
physical viscosity, so **Δt < 2ν/|u|²** independently of the grid. The solver therefore takes

  Δt = 0.95 min( CFL / max(|u|/h<sub>x</sub> + |v|/h<sub>y</sub>), 1.8 ν / max|u|² ), CFL = 0.5,

where points so close to the wall that viscosity dominates (cell Péclet < 2) do not limit the advective
CFL. The implicit diffusion matrices are refactored only when Δt leaves [0.7, 1]·Δt<sub>max</sub>.

*Alternative considered.* Second-order Adams–Bashforth advection removes the 2ν/|u|² limit, but a von
Neumann analysis shows AB2 with second-order upwinding is stable only for CFL ≤ 0.25 (the upwind symbol
reaches the real value 4c at θ = π, outside AB2's real stability interval), and it would need a stricter
near-wall exemption (cell Péclet ≤ 1). The gain is at most ≈2× at Re = 2000 and nothing at Re ≤ 500, so
the reference scheme was kept. Steady solutions do not depend on the time scheme.

### 4.6 Convergence and averaging

The force coefficients are sampled every 0.05 convective times. A run stops as **steady** when the
near-body residual max|Δu|/Δt < 10⁻⁴ and both C<sub>L</sub> and C<sub>D</sub> change by less than 10⁻⁴ per unit
time. Otherwise it runs to t<sub>end</sub> = 32 c/U<sub>∞</sub> and the mean flow state (face velocities,
pressures) is accumulated over the last 12 time units. Every post-processing operation is linear in
that state, so time-averaged forces, surface distributions and fields are exact averages of the
sampled states.

## 5. Boundary conditions

| Boundary | Velocity | Pressure | Implementation |
|---|---|---|---|
| Airfoil | u = v = 0 (no slip, no penetration) | — (no condition needed in a projection method) | cut cells at the exact wall (§4.3–4.4) |
| Inlet, x = −10c | u = U<sub>∞</sub>, v = 0 | homogeneous Neumann | known face velocity |
| Outlet, x = +20c | ∂u/∂t + U<sub>∞</sub> ∂u/∂x = 0 (convective), ∂v/∂x = 0 | p = 2ν ∂u/∂x (traction free) | Dirichlet pressure half a cell outside; its increment enters the projection |
| Top / bottom, y = ±10c ("open") | ∂u/∂y = 0, ∂v/∂y = 0 | p = p<sub>∞</sub> = 0 | Dirichlet pressure half a cell outside |

Options used only by the boundary-condition explorer (`lateral_bc`, `outlet_bc`):

* `lateral_bc="slip"`: free-slip walls, v = 0, ∂u/∂y = 0, ∂p/∂n = 0 (a wind tunnel without wall boundary layers).
* `outlet_bc="zero_gradient"`: u copied from the last interior face, p = 0.

The explorer runs NACA 0012, Re = 500, α = 4° in six configurations (`datagen.VARIANTS`): the baseline
(the same case as in the main dataset), an inlet 2c upstream, an outlet 2c downstream (convective and
zero-gradient), open sides at ±2c and slip walls at ±2c. No-slip is not an option: without it the
equations would be the Euler equations.

## 6. Aerodynamic calculations

### 6.1 Wall probes

Surface quantities come from 800 stations on the exact surface polygon (θ<sub>k</sub> = 2πk/800). At each
station, probes one and two local cell sizes *h* out along the wall normal are interpolated linearly
from the face values on a Delaunay triangulation of face midpoints plus wall points (u = 0); triangles
inside or crossing the body are removed, so interpolation never bridges the airfoil. The crossing test
(`segments_cross_polygon`) handles **non-convex** polygons (the reference's Cyrus–Beck clip assumed a
convex shape, true for NACA 0012 but not in general).

* Wall pressure: linear extrapolation p<sub>w</sub> = 2p(h) − p(2h).
* Wall shear: u<sub>t</sub>(d) = ad + bd² through u<sub>t</sub>(0) = 0, fitted to d = h, 2h:
  τ<sub>w</sub>/ρ = ν (4u<sub>t</sub>(h) − u<sub>t</sub>(2h))/(2h).

### 6.2 Forces and moment

**F** = Σ(−p<sub>w</sub>**n** + τ<sub>w</sub>**t**)Δs over the stations, split into pressure and friction parts
(C<sub>D</sub> = C<sub>D,p</sub> + C<sub>D,f</sub> is reported separately). The moment about the quarter-chord
point uses the same station forces; nose up is clockwise, so C<sub>m</sub> = −M<sub>z</sub>/(½ρU²c²).

### 6.3 Surface distributions

C<sub>p</sub> and C<sub>f</sub> are reported against x/c along the chord. C<sub>f</sub> is signed with the direction
from the leading edge towards the trailing edge on each surface: C<sub>f</sub> > 0 for attached flow,
C<sub>f</sub> < 0 for reversed (separated) flow. Upper/lower is decided from the surface parameter θ
(not from y > 0, which fails for cambered sections). Every second station is exported.

### 6.4 Stagnation, separation and reattachment points

Walking counter clockwise round the surface, the wall shear in the CCW direction changes sign at
critical points of the near-wall flow (`analysis.wall_critical_points`):

* − → + (flow leaves in both directions): an **attachment** point. The one closest (in arc length) to
  the pressure maximum is the **front stagnation point**; others are **reattachment** points.
* + → − (flow converges): **separation**. A convergence at the sharp trailing edge is where the flow
  leaves the body and is labelled `trailing_edge`, not separation.
* Sign runs shorter than 0.004c of arc length are merged into their neighbours (noise).

In a viscous flow every wall point has zero velocity, so this attachment-point definition (dividing
streamline, τ<sub>w</sub> = 0, near-maximum pressure) is the meaningful one. At low Re the maximum
C<sub>p</sub> exceeds 1 because of viscous normal stresses; the app states it when it happens.

### 6.5 Free stagnation points and eddy centres

On the uniform visualisation grid (§10), cells in which both u and v change sign are searched with
Newton's method on the bilinear interpolant. The velocity-gradient tensor J at the zero classifies it:
det J < 0 is a **saddle** (a free stagnation point, e.g. where a recirculation bubble closes);
det J > 0 with complex eigenvalues is an **eddy centre**. Points within 2.5 grid spacings of the body are
skipped (covered by §6.4). They are computed for the steady or time-averaged flow only.

### 6.6 Unsteady statistics and flow classes

Over the averaging window: mean, minimum, maximum and RMS of C<sub>L</sub> and C<sub>D</sub>; the linear trend;
and the Strouhal number St = fc/U<sub>∞</sub> from the peak of the Hann-windowed spectrum of the
detrended C<sub>L</sub> (parabolic peak interpolation; only frequencies with at least two cycles in the
window). Classes (`analysis.classify_flow`):

| Class | Meaning |
|---|---|
| `steady` | converged by the residual criterion before t<sub>end</sub> |
| `nearly_steady` | C<sub>L</sub> and C<sub>D</sub> varied by < 0.001 over the window but the residual test was not met |
| `periodic` | the spectral peak (±2 bins) carries > 50% of the C<sub>L</sub> fluctuation energy (vortex shedding) |
| `irregular` | unsteady without a dominant frequency |
| `not_converged` | the drift over the window exceeds the detrended fluctuation: more simulated time is needed |

### 6.7 Thin-airfoil theory

`theory.thin_airfoil` integrates the exact camber-slope of each section with adaptive quadrature split at
the camber kink (x = p or r). NACA 2412 gives α<sub>L=0</sub> = −2.077° and C<sub>m,c/4</sub> = −0.0531,
matching the standard textbook result (Anderson, *Fundamentals of Aerodynamics*). Values for all four
sections are in the manifest and the theory page.

## 7. Review of the reference scripts

### 7.1 `naca0012_solver.py` (basis of `solver.py`)

Preserved unchanged: grid generation, cut-face classification, control volumes, all operators, the
time-stepping scheme and its stability limit, the boundary conditions, the probe-based wall pressure
and shear, and the convergence test. **Parity**: on the same grid, after 300 steps, the ported solver
reproduces the original's face velocities to 6×10⁻¹³ and pressures to 6×10⁻¹⁰ (test
`test_port_reproduces_the_reference_solver`). Force coefficients differ by ~0.1% only because the
Delaunay triangulation of the (co-circular) Cartesian probe points is not unique and SciPy's and
matplotlib's Qhull calls choose differently.

Changes, each needed for the new scope or found in review:

| Issue in the reference | Consequence | Change |
|---|---|---|
| `is_inside_airfoil` uses \|y<sub>c</sub>\| ≤ t(x) | wrong for any cambered section | exact foot-point test (§4.2) |
| upper/lower decided by y<sub>c</sub> > 0 | wrong C<sub>p</sub> assignment for cambered sections | decided by the surface parameter θ |
| `segments_cross_airfoil` is a convex-polygon (Cyrus–Beck) clip | for a non-convex outline the clip region is wrong, so interpolation could bridge the body | general segment–polygon crossing test |
| `solid_interval` silently takes min/max of all crossings | a line crossing a concave body twice would be masked as one solid interval | explicit guard raising `GeometryError` |
| only NACA 0012 | — | NACA 4/5-digit sections and a cylinder via a `Body` interface |
| skin friction sign tied to the CCW tangent | unclear sign for plots | C<sub>f</sub> signed towards the trailing edge (§6.3) |
| matplotlib required by the core (`matplotlib.tri`) | heavy dependency for a solver | SciPy Delaunay; matplotlib only for optional plots |
| unsteady runs kept only force histories | no mean field | time-averaged flow state (§4.6) |
| Strouhal number, flow classification, moment, drag split not computed | — | added (§6) |
| lift-curve script compares with 2πα | wrong reference for cambered sections | 2π(α − α<sub>L=0</sub>) with computed α<sub>L=0</sub> |

### 7.2 `naca0012_lift_curve.py`

Its logic (independent runs per angle, means over the last convective times for unsteady cases, stall
only "whatever the CFD produces", warning when the maximum is the last angle) is carried into
`datagen.py` and the frontend's `assessStall`.

### 7.3 `incompressible_cavity_flow.py`

Reviewed but not used: it is a separate lid-driven cavity code with defects that make its results
unreliable — backward differences regardless of flow direction (downwind, hence unstable, where u < 0);
a collocated grid with central pressure gradients (pressure–velocity decoupling); 50 Jacobi iterations
per step, so continuity is not enforced; p = 0 imposed on the moving lid; t = 0.7 at the end, far from
steady; and post-processing that clips negative pressures and smooths the field. The airfoil solver's
projection method (exact Poisson solve, staggered grid, upwinding by flow direction) avoids all of these.

## 8. Validation

| Check | Result | Where |
|---|---|---|
| Discrete continuity | max \|D**u**\| < 10⁻⁹ every step; global inflow = outflow to 10⁻⁸ | `solver.project`, `test_solver.py` |
| Mirror symmetry | NACA 0012 at ±α: C<sub>L</sub>(α) + C<sub>L</sub>(−α) < 2×10⁻³ | `test_mirror_symmetry_of_symmetric_section` |
| Re-independence of operators | `reset(Re)` reproduces a fresh solver to 10⁻¹² | `test_reset_reproduces_a_fresh_solver` |
| Parity with the reference solver | 6×10⁻¹³ in velocity after 300 steps | §7.1 |
| Cylinder, Re = 20 and 40 (steady) | see table below | `validation.py`, `test_validation_slow.py` |
| Grid convergence, NACA 0012 | see table below | `data/validation.json` |
| Thin-airfoil theory | NACA 2412 textbook values to 0.002° / 0.0005 | `test_theory.py` |

**Circular cylinder** (same solver, cut-cell walls, D = 1, wall spacing 0.02D, same domain sizes):

| Re | C<sub>D</sub> | published C<sub>D</sub> | L<sub>rec</sub>/D | published L<sub>rec</sub>/D | separation angle | published |
|---|---|---|---|---|---|---|
| 20 | 2.056 | 2.045 (Dennis & Chang 1970), 2.00 (Fornberg 1980), 2.09 (Tritton 1959, exp.) | 0.964 | 0.94, 0.91, 0.93 (Coutanceau & Bouard 1977, exp.) | 43.1° | 43.7° |
| 40 | 1.529 | 1.522, 1.498, 1.59 | 2.356 | 2.345, 2.24, 2.13 | 53.0° | 53.8° |

**Grid study** (NACA 0012, steady cases):

| Case | coarse (≈17k cells) | medium (≈28k) | fine (≈67–69k) | medium − fine |
|---|---|---|---|---|
| Re 200, α 8°: C<sub>L</sub> / C<sub>D</sub> | 0.3956 / 0.2979 | 0.3931 / 0.3005 | 0.3970 / 0.3035 | −1.0% / −1.0% |
| Re 1000, α 4°: C<sub>L</sub> / C<sub>D</sub> | 0.1979 / 0.1118 | 0.2069 / 0.1157 | 0.2053 / 0.1202 | +0.8% / −3.7% |

Interpretation: on the production (medium) grid, lift is within about 1% of the fine grid. Drag is
under-predicted by about 1% at Re = 200 and 4% at Re = 1000, and C<sub>D</sub> still rises from medium to
fine, so the true drag at Re = 1000 may be a few per cent higher again. Expect larger errors at Re = 2000
(thinner layers on the same grid). The refinement ratios and growth rates differ between levels, so a
formal Richardson extrapolation / GCI is not meaningful here.

## 9. Precomputation workflow

```bash
cd simulations/fluids
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/pip install --no-deps -e backend

# one case, printed (and optionally saved + plotted)
.venv/bin/python -m eduphysics_fluids run --airfoil 2412 --re 500 --aoa 4 --verbose

# the dataset shipped with the frontend; resumable, longest cases first
.venv/bin/python -m eduphysics_fluids generate --preset core --workers 3
.venv/bin/python -m eduphysics_fluids generate --preset bc --workers 3     # boundary-condition explorer
.venv/bin/python -m eduphysics_fluids validate cylinder                     # writes data/validation.json
.venv/bin/python -m eduphysics_fluids manifest                              # rebuild manifest.json
```

| Preset | Cases | Content |
|---|---|---|
| `core` | 108 | 4 airfoils × Re {100, 200, 500, 1000} × α {−4 (cambered only), 0, 4, 8, 12, 16, 20} |
| `bc` | 6 (1 shared with `core`) | NACA 0012, Re 500, α 4°, domain / boundary-condition variants |
| `fine-angles` | 48 | adds α = 2, 6, 10 to the core Reynolds numbers |
| `high-re-subset` | 7 | Re = 2000 for NACA 0012 and 2412 at α ≤ 8° (shipped) |
| `high-re` | 27 | Re = 2000 at all core angles |
| `smoke` | 2 | tiny grid, t = 1 (CI pipeline test) |

Each case is an independent, impulsively started run. Cases are written as soon as they finish
(field file first, JSON last), so an interrupted generation resumes where it stopped; `--force`
recomputes. The manifest is rebuilt from the files present, so it never lists missing cases.

**Cost** (medium grid, Intel i5-8257U, 3 cases in parallel): a steady Re = 200 case ≈ 4 min, a steady
Re = 1000 case ≈ 9 min; unsteady Re = 1000 cases run the full 32 time units (≈ 60 000 steps, the
viscous time-step limit) and take ≈ 30–40 min. Re = 2000 costs twice that per case, which is why it is
a separate preset. Wall-clock times are recorded in every case file (`solver.solve_seconds`).

### 9.1 What the shipped dataset shows

These are observations from the computed cases (`core` + `bc` + `high-re-subset`, 120 in all), not
targets that the solver was tuned to. They are useful to sanity-check a regenerated dataset.

Flow classes of the 115 baseline cases (108 `core`, 7 `high-re-subset`):

| Re | steady | nearly steady | periodic | irregular / not converged |
|---|---|---|---|---|
| 100 | 27 | 0 | 0 | 0 |
| 200 | 23 | 0 | 4 (α = 20°) | 0 |
| 500 | 15 | 1 | 11 | 0 |
| 1000 | 12 | 2 | 13 | 0 |
| 2000 (NACA 0012, 2412; α ≤ 8°) | 5 | 0 | 2 (α = 8°) | 0 |

Shedding starts at lower angles as Re grows: none at Re = 100, α = 20° at Re = 200, α = 12–16° at
Re = 500 and α = 8–12° at Re = 1000 (NACA 2213 is periodic already at 8°). Periodic Strouhal numbers
based on chord lie between 0.36 and 1.21 (the highest at Re = 2000, α = 8°); based on the projected height
c·sin α + t·cos α they are 0.16–0.31 (median 0.24), close to the bluff-body value of about 0.2.

Per airfoil (least-squares lift slope through α ≤ 4°, maximum lift-to-drag ratio, drag at α = 0°):

| Airfoil | dC<sub>L</sub>/dα (per rad), Re 100 → 1000 | α<sub>L0</sub> fit (thin-airfoil value) | max L/D, Re 100 → 1000 | C<sub>D</sub>(α = 0), Re 100 → 1000 |
|---|---|---|---|---|
| NACA 0012 | 2.97 – 3.08 | 0.00° (0°) | 1.3 → 2.4 | 0.410 → 0.110 |
| NACA 2412 | 2.99 – 3.12 | −0.52 to −0.58° (−2.08°) | 1.4 → 3.0 | 0.410 → 0.111 |
| NACA 23012 | 2.92 – 3.06 | −0.88 to −0.93° (−1.09°) | 1.4 → 2.6 | 0.410 → 0.111 |
| NACA 2213 | 2.72 – 2.93 | −0.74 to −0.86° (−1.80°) | 1.4 → 2.7 | 0.416 → 0.113 |

* The lift slope is about half of 2π at every Reynolds number up to 1000 (and lower still at 2000): the thick viscous layers
  displace the outer flow and the Kutta condition is only approximately satisfied.
* Camber shifts the zero-lift angle by much less than thin-airfoil theory predicts: the aft-camber
  sections (2412, 2213) recover only about 25–50% of the theoretical shift; the forward-camber 23012
  about 80–85%.
* No lift maximum lies inside the computed range: C<sub>L</sub> still increases at α = 20° in every
  series, so the viewer reports “no stall angle identified”. At Re = 100–200 the lift curve bends
  over; at Re = 500–1000 it flattens between 8° and 12° as separation begins and steepens again from 16°
  as the time-averaged suction of the shed vortices grows.
* The upper-surface separation point of NACA 0012 moves forward with α and with Re (Re = 1000: x/c ≈
  0.88 at 4°, 0.17 at 12°, 0.05 at 20°; Re = 100: attached up to 12°).
* Maximum surface pressure coefficients range from 1.02 to 1.49, above the inviscid value 1, as expected
  from the viscous normal stress at low Re.
* Drag falls roughly as Re<sup>−0.6</sup> at α = 0° and is dominated by skin friction there (74–82%).
* Boundary-condition explorer (NACA 0012, Re 500, α 4°): shortening the inlet or outlet to 2 c changes
  C<sub>L</sub> by 2–3%; a narrow (±2 c) domain with slip walls raises C<sub>L</sub> by 11% (channel blockage),
  and a narrow open domain lowers it by 15% and makes the flow periodic. The baseline values are
  C<sub>L</sub> = 0.215, C<sub>D</sub> = 0.171.
* Re = 2000 subset: drag keeps falling (NACA 0012 at α = 0°: C<sub>D</sub> = 0.070), but lift at small angles
  is *lower* than at Re = 1000 (NACA 0012 at 4°: C<sub>L</sub> = 0.167 against 0.207; NACA 2412: 0.194 against
  0.239). The computed mechanism is trailing-edge separation: at α = 4° the upper-surface separation
  point moves from x/c ≈ 0.88 (0012) and 0.75 (2412) at Re = 1000 to ≈ 0.60 at Re = 2000, so the flow
  leaves the upper surface well ahead of the trailing edge and less circulation develops. Such
  non-linear, Re-dependent lift at small angles is a known feature of laminar low-Re airfoil flow, but these cases have not had
  their own grid study (§13). Shedding starts at α = 8° for both sections.

**Live API?** Not provided: a single steady case takes minutes and an unsteady one up to an hour, so
interactive computation is not compatible with a static deployment. Everything the viewer shows is
precomputed and loads instantly.

## 10. Data format

`data/manifest.json` — loaded once by the viewer:

* `airfoils[]`: id, family, thickness, camber and its position, leading-edge radius, thin-airfoil
  values, chord-frame outline (241 points) and camber line;
* `reynolds`, `angles[airfoil]`: the computed stops;
* `cases[]`: per case id, airfoil, Re, α, variant, flow class, C<sub>L</sub>, C<sub>D</sub> (split), C<sub>m</sub>,
  Strouhal number, stagnation and first upper-surface separation station, unsteady ranges;
* `bc_explorer`, `grids`, `field_window`, and `validation` (copied from `validation.json`).

`data/cases/<id>.json` — loaded on demand (≈ 40–60 kB): `flow` (class, times, averaging window,
Strouhal), `coefficients`, `theory`, `surface` (400 stations: x/c, upper flag, coordinates, C<sub>p</sub> and
C<sub>f</sub> per state), `wall_points`, `field_points`, `history` (t, C<sub>L</sub>, C<sub>D</sub>), `solver`
(grid, Δt, steps, timings, versions, git commit), and `field` (metadata of the binary file).

`data/cases/<id>.fields.bin.gz` — the flow on a uniform grid over x ∈ [−0.6, 2.4], y ∈ [−0.9, 0.7]
(spacing 0.0125c, 241 × 129 nodes) for each state (`instantaneous`, plus `mean` for unsteady runs), fields
in the order u/U<sub>∞</sub>, v/U<sub>∞</sub>, C<sub>p</sub>. Each field is quantised to 12-bit codes
(0…4094 linearly over [lo, hi] given in the JSON, 4095 inside the body), stored as little-endian uint16
with **row-wise delta coding** (first code, then differences mod 2¹⁶), then gzip. This is about 4×
smaller than raw 16-bit codes; velocity resolution is ≈ 5×10⁻⁴U<sub>∞</sub>. The grid is a *visualisation
product*: forces, C<sub>p</sub> and C<sub>f</sub> come from the solver data, not from it. The same file
format is decoded by `fields.decode` (Python) and `data/decode.ts` (TypeScript); a shared fixture in
`frontend/tests/fixtures/` keeps them in agreement.

## 11. Frontend architecture and data flow

```text
manifest.json ──► loader.loadManifest ──► App (hash router: #/simulator?airfoil=…&re=…&aoa=…)
                                           │
              selection.resolve ◄──────────┤  sliders offer only computed stops
                     │                     │
 cases/<id>.json + .fields.bin.gz ──► loader.loadCase (fetch, gunzip via DecompressionStream,
                     │                 decode.ts, in-memory cache, neighbour prefetch)
                     ▼
   SimulatorPage ─► FlowCanvas   (canvas: colour map, iso-lines, RK4 streamlines, markers, hover readout)
                ─► plots.tsx     (SVG charts: C_p, C_f, C_L–α with theory, C_D–α, force history)
                ─► explain.ts    (explanations generated from the case's numbers)
   BoundaryPage, HighLiftPage, TheoryPage
```

* `src/data/` — types mirroring the schema, decoder, loader, selection logic.
* `src/physics/` — pure functions: bilinear sampling, vorticity (central differences on the display
  grid), streamlines (RK4 in arc length, stopping at the body, stagnation or closed orbits), marching
  squares, colour maps, frame rotation, thin-airfoil theory, stall assessment, high-lift drawings.
* `src/content/` — all educational text: airfoil descriptions, explanation generator, high-lift device
  texts, boundary-condition texts. The theory page is `src/pages/TheoryPage.tsx` (KaTeX).
* `src/components/` — `FlowCanvas`, `Chart` (dependency-free SVG chart with range bars and
  click-to-select), plots, `SnapSlider`, badges (`SourceTag` labels every result's provenance), `Tex`,
  `Rich` (renders `C_L`-style subscripts in plain text).

The viewer imports the platform's shared look from `packages/ui` (Tailwind preset with the orbital
simulator's palette, base styles, `PlatformBar`). Vite serves `simulations/fluids/data` at `./data/` in
development and copies it into `dist/data/` on build (`vite.config.ts`); set `FLUIDS_DATA_DIR` to view
another dataset.

## 12. Changing content, adding airfoils and features

**Edit explanations.** Static text lives in `frontend/src/content/` (`airfoils.ts`, `highlift.ts`,
`boundaries.ts`) and `pages/TheoryPage.tsx`. Data-driven explanations are generated in
`content/explain.ts`; they may only state what the case data show (keep it that way) and are unit
tested in `tests/content.test.ts`. Use `C_L`-style notation in plain strings; `Rich` renders it.

**Add an airfoil.**
1. Any NACA 4-digit or standard 5-digit section works with `geometry.naca()`; add its designation to
   `datagen.AIRFOILS`. Other families: implement a `NacaSection`-like object with `half_thickness`,
   `camber`, `camber_slope`, `camber_curvature`, `surface` and `contains`, and a `Body` wrapper.
2. Generate it: `python -m eduphysics_fluids generate --preset core --workers 3` (existing cases are
   skipped). If a `GeometryError` appears, that angle needs the multi-interval face bookkeeping (§13).
3. Add its text to `frontend/src/content/airfoils.ts` (the content test checks coverage).

**Add Reynolds numbers or angles.** Add a preset in `datagen.preset()` (or extend `core`) and generate;
the sliders pick the new stops up from the manifest.

**Add a boundary-condition variant.** Add an entry to `datagen.VARIANTS` (domain sizes, `lateral_bc`,
`outlet_bc`), generate `--preset bc`, and describe it in `content/boundaries.ts`.

**Add a field view.** Add a key to `VIEW_INFO` in `components/FlowCanvas.tsx` and compute the scalar in
its `scalar` memo from u, v, C<sub>p</sub> (as vorticity does).

**Change the data format.** Bump `datagen.SCHEMA_VERSION`, update `fields.py`/`decode.ts` together and
regenerate the fixture (`pytest tests/test_frontend_fixture.py` writes it if absent; delete the old one).

## 13. Limitations and unsupported combinations

* **Physics**: two-dimensional, laminar, incompressible flow. No turbulence model and no spanwise
  instability. At the upper end of the Reynolds range, separated flows in reality become
  three-dimensional; the 2D results there are idealisations.
* **Reynolds number**: the shipped dataset covers 100–1000 for all four sections and Re = 2000 for NACA
  0012 and 2412 at α ≤ 8° only (the viewer offers Re = 2000 only for those two sections and, at that
  Re, snaps larger angles to 8°). The full `high-re`
  preset is supported but costs about an hour per unsteady case on a laptop. The grid study (§8) was done
  at Re ≤ 1000; at Re = 2000 the medium grid resolves the thinner boundary layer with fewer cells, so
  expect larger grid errors there, particularly in drag and in the trailing-edge separation point.
* **Angles**: the computed stops only (−4° to 20°). The guard of §4.3 rejects grid/geometry combinations
  where a grid line would meet the body in two intervals (concave lower surfaces at negative angles, e.g.
  NACA 2213 at large negative α); such cases are not offered.
* **Geometry**: one closed body; no multi-element configurations (slats, slotted flaps). The high-lift
  page is conceptual for this reason. Sharp trailing edges only.
* **Accuracy**: grid errors ≈ 1% in lift and up to ≈ 4% (or somewhat more) in drag at Re = 1000 (§8).
  Unsteady means depend on the 12-unit averaging window; slow modulations longer than that are not
  resolved. `not_converged` runs are shown but labelled.
* **Display grid**: fields are resampled to 0.0125c; the thinnest boundary layers at Re = 1000 span only
  a few display points, and the vorticity view is computed from this grid (it underestimates wall
  vorticity). Quantitative results always come from the solver data.
* **Time accuracy**: first order in time (Euler / backward Euler), with Δt set by the viscous limit
  (≈ 10³ steps per shedding cycle at Re = 1000), small compared with other errors.

## 14. Tests and continuous integration

| Suite | Command | Content |
|---|---|---|
| Python, fast (≈ 40 s) | `cd simulations/fluids && .venv/bin/python -m pytest` | geometry, theory, solver (continuity, symmetry, time step, BC variants, geometry guard), analysis, fields, data pipeline, shared binary fixture, committed dataset |
| Python, slow | `.venv/bin/python -m pytest -m slow` | cylinder benchmark at Re 20 and 40; parity with the reference solver (if present) |
| Lint | `.venv/bin/ruff check backend tests` | |
| Frontend unit | `npm test -w @eduphysics/fluids` (repository root) | decoder vs Python fixture, physics helpers, theory, selection, explanations, content, dataset via the TS decoder |
| Frontend e2e | `npm run build -w @eduphysics/fluids && npm run test:e2e:fluids` | browser smoke tests of all four pages (served from the built `dist/`, so rebuild after regenerating data) |
| Site e2e | `npm run build:site && npm run test:e2e:site` | portal → simulators → back |

`.github/workflows/fluids-ci.yml` runs the backend lint and fast tests, and the viewer's lint,
type-check, unit tests, build and browser tests; the slow validation job runs on manual dispatch.
