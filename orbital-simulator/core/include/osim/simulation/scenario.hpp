#pragma once
/**
 * Scenario description: everything needed to reproduce a run bit-for-bit.
 * The JSON schema is documented in docs/ARCHITECTURE.md ("Scenario schema").
 */

#include "osim/dynamics/dynamics_model.hpp"
#include "osim/estimators/estimator.hpp"
#include "osim/integrators/propagator.hpp"

#include <nlohmann/json.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace osim {

/// Physical model configuration (truth and estimator each have one, and may differ).
struct ModelSpec {
  std::string kind = "orbit6";  // orbit6 | rigid12 | cw6
  double mu = 3.986004418e14;   // m³/s²
  IntegratorConfig integrator;
  double mass = 100.0;          // kg
  double radius = 0.5;          // m (uniform sphere)
  Vec3 inertia = Vec3::Zero();  // kg·m²; zero means "uniform sphere from mass and radius"
  double cw_mean_motion = 0.0;  // rad/s (cw6 only)
  Mat Qc;                       // process-noise PSD (truth: actual random forcing)
};

/// Finite thrust arc. orbit6/cw6: thrust along `direction` in `frame`; rigid12: thrust
/// along body x plus body torques (constant + optional sinusoid).
struct ThrustSegment {
  std::string label;
  double start = 0.0, end = 0.0;  // s
  double thrust = 0.0;            // N
  std::string frame = "RTN";      // RTN | ECI | LVLH (orbit6/cw6)
  Vec3 direction = Vec3::UnitY(); // unit vector in `frame`
  Vec3 torque = Vec3::Zero();     // N·m (rigid12)
  Vec3 torque_amplitude = Vec3::Zero();  // N·m, τ += A sin(ω t)
  Vec3 torque_omega = Vec3::Zero();      // rad/s
};

/// Impulsive maneuver applied instantaneously at time t (after propagation to t and
/// before the measurements stamped at t).
struct ImpulseEvent {
  std::string label;
  double t = 0.0;
  Vec3 dv = Vec3::Zero();        // commanded Δv (m/s) in `frame`
  std::string frame = "RTN";     // RTN | ECI | LVLH
  bool known = true;             // does the estimator know about it?
  double true_magnitude_error = 0.0;   // fractional execution error (truth)
  double true_pointing_error = 0.0;    // rad, random axis ⟂ Δv (truth)
  Vec3 true_sigma = Vec3::Zero();      // m/s random execution noise (truth)
  Vec3 assumed_sigma = Vec3::Zero();   // m/s execution uncertainty assumed by the estimator
};

struct ControlSpec {
  std::vector<ThrustSegment> segments;
  std::vector<ImpulseEvent> impulses;
  double true_scale_error = 0.0;   // actual = (1 + e) commanded
  Vec telemetry_sigma_true;        // control_dim; measured control = actual + noise
  bool estimator_knows_thrust = true;
};

struct EstimatorSpec {
  std::string type = "ekf";
  ModelSpec model;
  Vec x0;   // initial estimate
  Mat P0;   // initial covariance
  EstimatorSettings settings;
};

struct Scenario {
  nlohmann::json raw;  // the source document (sensors are built from it)
  std::string id, name, description;
  std::uint64_t seed = 1;
  std::string epoch = "2026-01-01T00:00:00Z";  // informational; t = 0 at the epoch
  double theta_g0 = 0.0;                         // Greenwich angle at epoch (rad)
  double duration = 3600.0;                      // s
  double dt = 10.0;                              // s, output/record grid
  ModelSpec truth;
  Vec x0_true;
  ControlSpec controls;
  EstimatorSpec estimator;
};

/// Parse and validate a scenario; throws ConfigError with a readable message.
Scenario parse_scenario(const nlohmann::json& j);
Scenario load_scenario_file(const std::string& path);
/// Build the dynamics model described by spec.
DynamicsModelPtr build_model(const ModelSpec& spec);
/// Parse estimator-only settings (type, P0, Q, UKF/PF/KF parameters) from JSON.
EstimatorSpec parse_estimator_spec(const nlohmann::json& j, const ModelSpec& truth, const Vec& x0_true);

}  // namespace osim
