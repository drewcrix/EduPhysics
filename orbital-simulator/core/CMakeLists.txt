option(OSIM_SANITIZE "Build with address/undefined-behaviour sanitizers" OFF)

set(OSIM_SOURCES
  src/rng.cpp
  src/dynamics/point_mass_gravity.cpp
  src/dynamics/orbital_dynamics.cpp
  src/dynamics/rigid_spacecraft_dynamics.cpp
  src/dynamics/cw_dynamics.cpp
  src/integrators/rk4.cpp
  src/integrators/propagator.cpp
  src/frames/frames.cpp
  src/frames/attitude.cpp
  src/sensors/sensor.cpp
  src/sensors/basic_sensors.cpp
  src/sensors/ground_station.cpp
  src/sensors/sensor_registry.cpp
  src/estimators/covariance_utils.cpp
  src/estimators/ekf.cpp
  src/estimators/ukf.cpp
  src/estimators/particle_filter.cpp
  src/estimators/linear_kf.cpp
  src/estimators/estimator_registry.cpp
  src/simulation/json_util.cpp
  src/simulation/scenario.cpp
  src/simulation/controls.cpp
  src/simulation/simulation.cpp
  src/diagnostics/statistics.cpp
  src/diagnostics/observability.cpp
  src/diagnostics/ellipsoid.cpp
  src/diagnostics/metrics.cpp
)

add_library(osim_core STATIC ${OSIM_SOURCES})
target_include_directories(osim_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(osim_core PUBLIC osim_eigen nlohmann_json::nlohmann_json)
target_compile_definitions(osim_core PUBLIC
  OSIM_SCENARIO_DIR="${PROJECT_SOURCE_DIR}/scenarios")

# Strict warnings for our own code only; -ffp-contract=off keeps results identical
# between native and WebAssembly builds (no compiler-inserted fused multiply-adds).
if(CMAKE_CXX_COMPILER_ID MATCHES "Clang|GNU")
  target_compile_options(osim_core PRIVATE -Wall -Wextra -Wpedantic -Wshadow -Wconversion
    -Wno-sign-conversion)
  target_compile_options(osim_core PUBLIC -ffp-contract=off)
elseif(MSVC)
  target_compile_options(osim_core PRIVATE /W4 /fp:precise)
endif()

if(OSIM_SANITIZE AND NOT EMSCRIPTEN)
  target_compile_options(osim_core PUBLIC -fsanitize=address,undefined -fno-omit-frame-pointer)
  target_link_options(osim_core PUBLIC -fsanitize=address,undefined)
endif()

if(NOT EMSCRIPTEN)
  # Headless command-line runner: runs a scenario file, prints a summary or CSV.
  add_executable(osim_cli apps/osim_cli.cpp)
  target_link_libraries(osim_cli PRIVATE osim_core)
endif()

if(OSIM_BUILD_TESTS)
  enable_testing()
  FetchContent_Declare(doctest
    URL https://github.com/doctest/doctest/archive/refs/tags/v2.4.11.tar.gz
    URL_HASH SHA256=632ed2c05a7f53fa961381497bf8069093f0d6628c5f26286161fbd32a560186
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    SOURCE_SUBDIR do-not-add-subdirectory)  # header only
  FetchContent_MakeAvailable(doctest)

  # One executable per test area so CTest reports each area separately.
  set(OSIM_TESTS
    test_dynamics
    test_integrators
    test_frames
    test_sensors
    test_covariance
    test_estimators
    test_simulation
    test_diagnostics
    test_regression
  )
  foreach(t ${OSIM_TESTS})
    add_executable(${t} tests/${t}.cpp tests/test_main.cpp)
    target_include_directories(${t} PRIVATE ${doctest_SOURCE_DIR}/doctest tests)
    target_link_libraries(${t} PRIVATE osim_core)
    add_test(NAME ${t} COMMAND ${t})
    set_tests_properties(${t} PROPERTIES LABELS "unit")
  endforeach()
  set_tests_properties(test_regression PROPERTIES LABELS "regression")

  # The CLI must run every shipped scenario to completion with finite results.
  add_test(NAME cli_all_scenarios COMMAND osim_cli --check-all ${PROJECT_SOURCE_DIR}/scenarios)
  set_tests_properties(cli_all_scenarios PROPERTIES LABELS "regression")
endif()

if(OSIM_BUILD_WASM)
  add_executable(osim_wasm bindings/wasm_bindings.cpp)
  target_link_libraries(osim_wasm PRIVATE osim_core)
  set_target_properties(osim_wasm PROPERTIES OUTPUT_NAME "osim" SUFFIX ".mjs")
  target_link_options(osim_wasm PRIVATE
    -lembind
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=createOsimModule
    -sENVIRONMENT=web,worker,node
    -sALLOW_MEMORY_GROWTH=1
    -sINITIAL_MEMORY=33554432
    -sSTACK_SIZE=1048576
    -sDISABLE_EXCEPTION_CATCHING=0
    -sASSERTIONS=0
    -O3)
  target_compile_options(osim_core PUBLIC -fexceptions)
  target_compile_options(osim_wasm PRIVATE -fexceptions -O3)
endif()
