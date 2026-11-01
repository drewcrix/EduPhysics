#pragma once
/**
 * Simulation orchestrator: owns the truth, the sensors, the control model and one
 * estimator, and advances them through a deterministic sequence of nodes.
 *
 * Node times are the union of the record grid (k·dt), every sensor's sample times
 * (enabled or not, so toggling a sensor never changes the truth trajectory), impulse times
 * and thrust-segment boundaries. At each node t_k:
 *
 *   PREDICT phase   1. controls for [t_{k−1}, t_k) are evaluated at t_{k−1} (zero-order hold)
 *                   2. truth propagates with the actual control (+ true process noise)
 *                   3. the estimator predicts with the measured control (if known)
 *                   4. impulses stamped at t_k are applied: truth gets the executed Δv,
 *                      the estimator gets the commanded Δv only if the burn is known
 *   UPDATE phase    5. sensors with a sample at t_k are processed in scenario order:
 *                      disabled → outage → visibility (truth geometry) → support check →
 *                      simulate with R_true → estimator update with R_assumed
 *                   6. history and evaluation metrics (errors, NEES) are recorded
 *
 * Node 0 is t = 0 and starts in the UPDATE phase (an initial fix is possible).
 *
 * User actions (toggling sensors, retuning noise, scheduling burns, switching estimator)
 * are applied at a phase boundary and logged with (node, phase). Replaying the scenario
 * with that log reproduces the run bit-for-bit, independent of how fast it was played.
 */

#include "osim/estimators/estimator.hpp"
#include "osim/sensors/sensor.hpp"
#include "osim/simulation/controls.hpp"
#include "osim/simulation/scenario.hpp"

#include <nlohmann/json.hpp>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace osim {

/// Availability of a sensor at a node, for the sensor timeline.
enum class SensorStatus : std::int8_t {
  NoSample = 0,
  Used = 1,
  Disabled = 2,
  Outage = 3,
  NotVisible = 4,
  Unsupported = 5,
  Failed = 6,
};

struct NodeRecord {
  long long node = 0;
  double t = 0.0;
  Vec x_true;            // truth (evaluation only; never given to the estimator)
  Vec x_prior;           // estimate after prediction, before measurements
  Mat P_prior;
  Vec x_est;             // estimate after measurements
  Mat P;
  Vec err;               // x_true ⊖ x_est (angles wrapped)
  double nees = 0.0;     // errᵀ P⁻¹ err
  Vec3 err_rtn = Vec3::Zero();    // position error in the true RTN frame (orbit models)
  Vec3 sigma_rtn = Vec3::Zero();  // 1σ position uncertainty along R, T, N
  Vec u_actual, u_measured;
  std::vector<SensorStatus> sensor_status;
  bool impulse = false;
  double ess = -1.0;
  double predict_us = 0.0, update_us = 0.0;  // wall time (not part of the replay hash)
};

struct InnovationRecord {
  long long node = 0;
  double t = 0.0;
  int sensor = -1;
  long long sample = 0;
  Vec z;      // the measurement itself (so a run can be re-filtered offline)
  Vec nu;     // innovation
  Vec sigma;  // sqrt(diag S)
  double nis = 0.0;
};

class Simulation {
 public:
  enum class Phase { Predict, Update };

  explicit Simulation(Scenario sc);
  static Simulation from_json(const nlohmann::json& j);

  bool finished() const;
  Phase next_phase() const { return phase_; }
  long long node_index() const { return node_; }
  double time() const { return t_; }
  /// Time of the next node (where the next prediction will end).
  double next_node_time() const;

  void step_predict();
  void step_update();
  /// One full node: predict (if pending) then update.
  void step();
  void run_until(double t);
  void run_to_end();

  /// Apply a user action now (at the current phase boundary) and record it.
  void apply_action(const nlohmann::json& action);
  /// Schedule recorded actions [{node, phase, action}, ...] for replay.
  void schedule_actions(const nlohmann::json& log);
  const nlohmann::json& action_log() const { return action_log_; }

  const Scenario& scenario() const { return sc_; }
  const DynamicsModel& truth_model() const { return *truth_model_; }
  const DynamicsModel& estimator_model() const { return *est_model_; }
  const Estimator& estimator() const { return *est_; }
  const std::vector<SensorPtr>& sensors() const { return sensors_; }
  const ControlModel& controls() const { return controls_; }
  const std::vector<NodeRecord>& history() const { return history_; }
  const std::vector<InnovationRecord>& innovations() const { return innovations_; }
  const std::vector<long long>& measurements_used() const { return used_; }
  const std::vector<std::string>& messages() const { return messages_; }
  const Vec& true_state() const { return x_true_; }

  /// Per-sensor support for the current model/estimator ("" = supported).
  std::vector<std::string> sensor_support() const;
  /// FNV-1a hash over all deterministic history values (states, covariances, innovations).
  std::uint64_t history_hash() const;

 private:
  void build_estimator(const std::string& type, const nlohmann::json& params, bool handoff);
  void apply_scheduled();
  void record_node();
  void note(const std::string& msg);
  int sensor_index(const std::string& id) const;

  Scenario sc_;
  DynamicsModelPtr truth_model_, est_model_;
  std::vector<SensorPtr> sensors_;
  ControlModel controls_;
  EstimatorPtr est_;

  double t_ = 0.0;
  long long node_ = 0;
  Phase phase_ = Phase::Update;
  Vec x_true_;
  NodeRecord pending_;
  long long impulse_counter_ = 0;
  std::vector<long long> used_;
  std::vector<NodeRecord> history_;
  std::vector<InnovationRecord> innovations_;
  std::vector<std::string> messages_;
  nlohmann::json action_log_ = nlohmann::json::array();
  nlohmann::json scheduled_ = nlohmann::json::array();
};

const char* to_string(SensorStatus s);

}  // namespace osim
