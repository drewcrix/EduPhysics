# Mission Control Academy — C++20 simulation core.
#
# Builds the same sources natively (library, CLI, tests) and with Emscripten
# (WebAssembly module for the browser). Dependencies are pinned by URL and SHA-256.
cmake_minimum_required(VERSION 3.21)
project(orbital_simulator VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(OSIM_BUILD_TESTS "Build the native unit and regression tests" ON)
option(OSIM_BUILD_WASM "Build the WebAssembly bindings (requires Emscripten)" OFF)

if(EMSCRIPTEN)
  set(OSIM_BUILD_WASM ON)
  set(OSIM_BUILD_TESTS OFF)
endif()

include(FetchContent)
set(FETCHCONTENT_QUIET ON)

# Eigen 3.4.0 (header only). We do not need its own build/tests.
FetchContent_Declare(eigen
  URL https://gitlab.com/libeigen/eigen/-/archive/3.4.0/eigen-3.4.0.tar.gz
  URL_HASH SHA256=8586084f71f9bde545ee7fa6d00288b264a2b7ac3607b974e54d13e7162c1c72
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  SOURCE_SUBDIR do-not-add-subdirectory)  # fetch only; Eigen's own CMake project is not needed
FetchContent_MakeAvailable(eigen)
add_library(osim_eigen INTERFACE)
target_include_directories(osim_eigen SYSTEM INTERFACE ${eigen_SOURCE_DIR})
# Deterministic results across native/WASM: no fused multiply-add contraction, no
# platform-specific vectorised reductions.
target_compile_definitions(osim_eigen INTERFACE EIGEN_DONT_VECTORIZE EIGEN_MPL2_ONLY)

# nlohmann/json 3.11.3 for scenario files.
FetchContent_Declare(nlohmann_json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
  URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(nlohmann_json)

if(OSIM_BUILD_TESTS)
  enable_testing()
endif()
add_subdirectory(core)
