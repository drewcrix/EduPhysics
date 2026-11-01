# Requirements and reproducible setup

All versions below were used to build and test this release. "Minimum" is the oldest
version the build is designed for; the "tested" column records what actually ran.

## Toolchains

| Tool | Minimum | Tested (macOS 13.1, x86_64) | Notes |
|---|---|---|---|
| C++ compiler | C++20: Clang 14, GCC 11, MSVC 19.30 | Apple Clang 14.0.3 | Uses `<numbers>`, designated init, concepts-free C++20 |
| CMake | 3.21 (presets v3) | 3.31.6 (pip wheel) | `cmake --preset …` |
| Ninja | 1.10 | 1.11.1 (pip wheel) | Generator used by all presets |
| Eigen | 3.4.0 (pinned) | 3.4.0 | Fetched by CMake, SHA-256 checked |
| nlohmann/json | 3.11.3 (pinned) | 3.11.3 | Fetched by CMake, SHA-256 checked |
| doctest | 2.4.11 (pinned) | 2.4.11 | Tests only; fetched, SHA-256 checked |
| Emscripten (emsdk) | 4.0.10 (pinned) | 4.0.10 | WebAssembly build |
| Node.js | 20.11 | 26.4.0 (local), 22 (CI) | Vite 5 / Vitest 2 |
| npm | 10 | 11.17 | Uses `package-lock.json` (`npm ci`) |
| Browser | Chrome/Edge 113+, Firefox 115+, Safari 16.4+ | Google Chrome (stable) via Playwright | Needs WebAssembly, ES modules in workers; WebGL for 3-D (2-D fallback otherwise) |
| Python | — | not required | No production or build step uses Python |

No API keys, accounts or network services are needed at run time. Network access is
needed only to download the pinned dependencies on first build.

## Dependency manifests

| File | Pins |
|---|---|
| `CMakeLists.txt` | Eigen, nlohmann/json (URL + SHA-256) |
| `core/CMakeLists.txt` | doctest (URL + SHA-256) |
| `CMakePresets.json` | `native`, `native-debug` (ASan/UBSan), `wasm` |
| `web/package.json` + `web/package-lock.json` | Exact versions of every npm package |
| `.github/workflows/orbital-simulator-ci.yml` | Runner OS, Emscripten 4.0.10, Node 22 |

There is intentionally no `requirements.txt`: Python is not used.

## Setup from scratch

### macOS

```bash
xcode-select --install                     # Apple Clang
python3 -m venv .tools/venv                # or: brew install cmake ninja
.tools/venv/bin/pip install cmake==3.31.6 ninja==1.11.1.4
export PATH="$PWD/.tools/venv/bin:$PATH"
git clone --depth 1 https://github.com/emscripten-core/emsdk.git .tools/emsdk
.tools/emsdk/emsdk install 4.0.10 && .tools/emsdk/emsdk activate 4.0.10
source .tools/emsdk/emsdk_env.sh
```

### Ubuntu 22.04+

```bash
sudo apt-get install -y build-essential cmake ninja-build nodejs npm
git clone --depth 1 https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install 4.0.10 && ~/emsdk/emsdk activate 4.0.10 && source ~/emsdk/emsdk_env.sh
```

### Windows

Use Visual Studio 2022 (MSVC 19.30+) with the "C++ CMake tools" workload, or WSL2 with the
Ubuntu steps. The `wasm` preset needs emsdk activated in the same shell.

### Build, test, run

```bash
cmake --preset native && cmake --build --preset native && ctest --preset native
cmake --preset wasm   && cmake --build --preset wasm
cd web && npm ci && npm run dev        # or: npm run build && npm run preview
```

### Disk space

Approximate footprint: emsdk 1.6 GB, `web/node_modules` 175 MB, native build 60 MB,
debug/sanitizer build ~900 MB (delete after use), WebAssembly build 20 MB. Playwright uses the installed
Chrome locally (`channel: "chrome"`); CI downloads Chromium.

## Continuous integration

Workflow: `EduPhysics/.github/workflows/orbital-simulator-ci.yml`. It is triggered on
`push` and `pull_request` when files under `orbital-simulator/` (or the workflow itself)
change, and manually via *workflow_dispatch*. Jobs:

| Job | What fails it |
|---|---|
| `native` (ubuntu-latest, macos-latest) | compile error, any CTest failure (`-L unit`, `-L regression`) |
| `sanitizers` | any ASan/UBSan report or test failure in the Debug build |
| `wasm` | Emscripten build error; any scenario failing or diverging from native in `scripts/wasm_integration_test.mjs` |
| `frontend` | ESLint error, TypeScript error, Vitest failure (incl. content validation and WASM determinism), build error, Playwright failure |

How to inspect: on GitHub, open the commit or pull request → **Checks** tab → *Orbital
Simulator CI*. Each job lists its steps with logs; failed Playwright runs upload a
`playwright-report` artifact. A status badge can be added to the README with:

```markdown
![Orbital Simulator CI](https://github.com/<owner>/<repo>/actions/workflows/orbital-simulator-ci.yml/badge.svg)
```

The workflow has `permissions: contents: read`, never deploys, publishes or pushes.
Note: at the time of writing the `EduPhysics` folder is not a Git repository, so the
workflow has been validated as YAML locally but has not yet run on GitHub.
