# EduPhysics

Interactive physics simulators for engineering students. Each simulator pairs a real numerical model
with the theory behind it and labels every result for what it is: simulation, analytical theory,
published data or a conceptual sketch.

| Simulator | Topic | Engine |
|---|---|---|
| **Mission Control Academy** (`simulations/orbital/`) | Orbit determination and state estimation | C++20 compiled to WebAssembly, runs live in the browser |
| **Airfoil Flow Lab** (`simulations/fluids/`) | Low-Reynolds-number aerodynamics: Navier–Stokes, boundary layers, separation, lift and drag, thin-airfoil theory, high-lift devices | Python cut-cell Navier–Stokes solver; results precomputed offline and loaded instantly |

A landing page (`apps/portal/`) lists the simulators. The three apps build into one static site:

```text
/            portal
/orbital/    Mission Control Academy
/fluids/     Airfoil Flow Lab
```

## Repository layout

```text
EduPhysics/
├── apps/portal/                 landing page and simulator catalogue (React, Vite, Tailwind)
├── packages/ui/                 shared look: Tailwind preset, base styles, PlatformBar
├── simulations/
│   ├── orbital/                 Mission Control Academy (unchanged; own README, docs, CMake, web/)
│   └── fluids/
│       ├── backend/             Python solver, analysis, dataset generator (eduphysics_fluids)
│       ├── data/                precomputed CFD dataset loaded by the viewer
│       ├── frontend/            React viewer
│       ├── tests/               pytest suite
│       └── IMPLEMENTATION.md    equations, numerics, validation, data format, extending
├── scripts/                     build-site.mjs (assemble dist-site/), preview-site.mjs
├── e2e/                         browser test of the assembled site
├── .github/workflows/           orbital, fluids and platform CI; GitHub Pages deployment
└── package.json                 npm workspaces: packages/ui, apps/portal, simulations/fluids/frontend
```

The orbital simulator keeps its own structure, lockfile and tooling (`simulations/orbital/README.md`);
it is deliberately not an npm workspace member, so its build is exactly as before.

## Prerequisites

* Node.js ≥ 20.11 (CI uses 22) and npm.
* Python ≥ 3.10 (the dataset was generated with 3.12) — only to run tests or regenerate CFD data.
* For the orbital simulator: a C++20 compiler, CMake ≥ 3.21, Ninja and Emscripten 4.0.10
  (see `simulations/orbital/docs/REQUIREMENTS.md`).

## Running locally

### Install

```bash
npm install                                   # portal, shared UI, fluids viewer (root workspaces)
cd simulations/orbital/web && npm ci && cd -  # orbital web app (separate lockfile)
```

### One app at a time (development servers)

```bash
npm run dev:fluids        # Airfoil Flow Lab   http://localhost:5174
npm run dev:portal        # portal             http://localhost:5175
cd simulations/orbital/web && npm run dev     # orbital  http://localhost:5173 (needs the WASM build, below)
```

The fluids viewer reads the committed dataset in `simulations/fluids/data/`; nothing needs computing to
run it. Links between apps are relative, so in development use the assembled site (next section) to
navigate from the portal into the simulators.

### The full platform

```bash
# 1. orbital WebAssembly core (once; see simulations/orbital/README.md for toolchain setup)
cd simulations/orbital
cmake --preset wasm && cmake --build --preset wasm
cd ../..

# 2. build all three apps and assemble dist-site/, then serve it
npm run build:site
npm run preview:site      # http://localhost:4180/
```

`build:site` builds the portal and fluids viewer, builds the orbital web app (`npm run build` in
`simulations/orbital/web`, which copies the WASM module), and copies the three outputs into
`dist-site/`. Options: `--skip-orbital-build` reuses an existing orbital `web/dist`, and
`--allow-missing-orbital` assembles without it.

## Testing

| What | Command |
|---|---|
| Portal, shared UI, fluids viewer: lint, types, unit tests | `npm run lint && npm run typecheck && npm test` |
| Fluids viewer browser tests (installed Chrome locally; they serve the built `dist/`) | `npm run build -w @eduphysics/fluids && npm run test:e2e:fluids` |
| Assembled site browser test | `npm run build:site && npm run test:e2e:site` |
| Fluids backend (Python) | see below |
| Orbital simulator (C++, WASM, web) | see `simulations/orbital/README.md` |

Fluids backend:

```bash
cd simulations/fluids
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt && .venv/bin/pip install --no-deps -e backend
.venv/bin/ruff check backend tests
.venv/bin/python -m pytest             # fast suite (~40 s), includes checks of the committed dataset
.venv/bin/python -m pytest -m slow     # cylinder benchmark vs published data, parity with the reference solver
```

## Regenerating the CFD dataset

```bash
cd simulations/fluids
.venv/bin/python -m eduphysics_fluids generate --preset core --workers 3   # 108 cases, resumable
.venv/bin/python -m eduphysics_fluids generate --preset bc --workers 3     # boundary-condition explorer
.venv/bin/python -m eduphysics_fluids validate cylinder                     # validation record
```

This takes several hours on a laptop (unsteady Re = 1000 cases need ~60 000 time steps each); finished
cases are kept, so an interrupted run resumes. `--preset high-re-subset` (shipped) adds Re = 2000 for NACA 0012 and 2412
up to α = 8°; `--preset high-re` computes Re = 2000 at every core angle. Details, timings and
the data format: `simulations/fluids/IMPLEMENTATION.md`.

## Continuous integration and deployment

| Workflow | Runs on | Does |
|---|---|---|
| `orbital-simulator-ci.yml` | changes in `simulations/orbital/` | native C++ build and CTest (Linux, macOS), sanitizers, WASM build compared with native, web lint/types/tests/build/browser tests |
| `fluids-ci.yml` | changes in `simulations/fluids/`, `packages/ui/` | Python lint and tests (incl. dataset integrity), viewer lint/types/tests/build/browser tests; slow numerical validation on manual dispatch |
| `platform-ci.yml` | changes in `apps/`, `packages/`, `scripts/` | portal lint/types/tests, site assembly (uploaded as an artifact) |
| `deploy-pages.yml` | manual (`workflow_dispatch`) | builds the WASM core and all three apps, deploys `dist-site/` to GitHub Pages |

To deploy: in the repository settings set **Pages → Source: GitHub Actions**, then run *Deploy site to
GitHub Pages* from the Actions tab. Every app uses relative asset URLs, so any static host works:
upload the contents of `dist-site/` (serve `.wasm` as `application/wasm`).

## Adding a simulator

1. Create it under `simulations/<name>/` as a self-contained app whose build uses relative URLs
   (Vite `base: './'`); use `@eduphysics/ui` (Tailwind preset, `PlatformBar`) for a consistent look.
2. Add an entry to `apps/portal/src/catalog.ts`.
3. Build it into `dist-site/<name>/` in `scripts/build-site.mjs`, and add a CI workflow.
