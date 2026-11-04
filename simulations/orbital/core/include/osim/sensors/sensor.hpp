#pragma once
/**
 * Sensor interface: timing, outages, true vs. assumed noise, measurement function h,
 * Jacobian H and residual (angle-aware z ⊖ ẑ).
 *
 * Two covariances are kept on purpose:
 *   R_true    — used only to generate simulated measurements from truth;
 *   R_assumed — what the estimator believes; mismatch is a teachable experiment.
 */

#include "osim/dynamics/dynamics_model.hpp"
#include "osim/rng.hpp"

#include <memory>
#include <string>
#include <vector>

namespace osim {

struct Measurement {
  int sensor_index = -1;   // position in the scenario's sensor list
  std::string sensor_id;
  double t = 0.0;          // s since epoch
  long long sample = 0;    // sample counter k (t = phase + k · period)
  Vec z;                   // measured value
};

struct SensorConfig {
  std::string id;
  std::string name;
  bool enabled = true;
  double period = 10.0;    // s between samples
  double phase = 0.0;      // s offset of the first sample
  std::vector<Interval> outages;
  Mat R_true;
  Mat R_assumed;
  double cost = 1.0;       // tracking-resource cost per accepted measurement
};

/**
 * What an estimator is allowed to know about a sensor: the measurement model and the
 * *assumed* noise. It deliberately has no access to the true noise or to simulate().
 */
class MeasurementModel {
 public:
  virtual ~MeasurementModel() = default;
  virtual const std::string& id() const = 0;
  virtual std::string type() const = 0;
  virtual int dim() const = 0;
  virtual std::vector<ComponentLabel> labels() const = 0;
  /// Empty when this sensor works with the model, else an explanation for students.
  virtual std::string unsupported_reason(const DynamicsModel& model) const;

  /// Noise-free measurement function z = h(t, x).
  virtual Vec h(double t, const Vec& x) const = 0;
  /// Jacobian ∂h/∂x.
  virtual Mat H(double t, const Vec& x) const = 0;
  /// True when h is linear in x (so the standard KF needs no linearisation).
  virtual bool is_linear() const { return false; }
  /// Geometric availability (line of sight, elevation mask, ...).
  virtual bool visible(double t, const Vec& x) const;
  /// z ⊖ ẑ with angle components wrapped into (-pi, pi].
  virtual Vec residual(const Vec& z, const Vec& zhat) const;
  /// Measurement covariance the estimator should use at its current estimate (from R_assumed).
  virtual Mat filter_covariance(const Vec& x_est) const = 0;
};

class Sensor : public MeasurementModel {
 public:
  explicit Sensor(SensorConfig cfg);

  /// Simulated measurement from the true state, using R_true.
  virtual Vec simulate(double t, const Vec& x_true, Rng& rng) const;
  Mat filter_covariance(const Vec& x_est) const override;

  // Schedule ---------------------------------------------------------------
  const SensorConfig& config() const { return cfg_; }
  const std::string& id() const override { return cfg_.id; }
  bool enabled() const { return cfg_.enabled; }
  void set_enabled(bool on) { cfg_.enabled = on; }
  bool in_outage(double t) const;
  void set_outages(std::vector<Interval> outages) { cfg_.outages = std::move(outages); }
  /// Change the cadence from time t on: the next sample is at t + period.
  void set_period(double period, double t);
  double sample_time(long long k) const { return cfg_.phase + static_cast<double>(k) * cfg_.period; }
  /// First sample index whose time is strictly after t (within 1e-9 s).
  long long next_sample_after(double t) const;

  const Mat& R_true() const { return cfg_.R_true; }
  const Mat& R_assumed() const { return cfg_.R_assumed; }
  void set_R_true(const Mat& R);
  void set_R_assumed(const Mat& R);

 protected:
  SensorConfig cfg_;
  void check_noise_dims() const;
};

using SensorPtr = std::shared_ptr<Sensor>;

}  // namespace osim
