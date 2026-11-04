#pragma once
/**
 * Sensors whose measurement is (nearly) a direct readout of state components.
 */

#include "osim/sensors/sensor.hpp"

namespace osim {

/**
 * GNSS-derived position fix: the receiver's navigation solution (already computed from
 * pseudoranges), modelled as z = r + v. This is *not* a raw pseudorange measurement.
 * In the CW lab the same sensor reads the relative LVLH position (a relative-navigation fix).
 */
class GnssPositionSensor final : public Sensor {
 public:
  explicit GnssPositionSensor(SensorConfig cfg);
  std::string type() const override { return "gnss_position"; }
  int dim() const override { return 3; }
  std::vector<ComponentLabel> labels() const override;
  Vec h(double t, const Vec& x) const override;
  Mat H(double t, const Vec& x) const override;
  bool is_linear() const override { return true; }
};

/// GNSS position + velocity navigation solution (introductory variant).
class GnssPositionVelocitySensor final : public Sensor {
 public:
  explicit GnssPositionVelocitySensor(SensorConfig cfg);
  std::string type() const override { return "gnss_pv"; }
  int dim() const override { return 6; }
  std::vector<ComponentLabel> labels() const override;
  Vec h(double t, const Vec& x) const override;
  Mat H(double t, const Vec& x) const override;
  bool is_linear() const override { return true; }
};

/// Rate gyroscope: body angular rate plus an optional constant true bias (not estimated).
class GyroSensor final : public Sensor {
 public:
  GyroSensor(SensorConfig cfg, Vec3 true_bias);
  std::string type() const override { return "gyro"; }
  int dim() const override { return 3; }
  std::vector<ComponentLabel> labels() const override;
  std::string unsupported_reason(const DynamicsModel& model) const override;
  Vec h(double t, const Vec& x) const override;
  Mat H(double t, const Vec& x) const override;
  bool is_linear() const override { return true; }
  Vec simulate(double t, const Vec& x_true, Rng& rng) const override;

 private:
  Vec3 bias_;
};

/**
 * Star tracker. A real star tracker outputs an attitude quaternion with roughly isotropic
 * small-angle error about body axes. We simulate exactly that — C_meas = C_true Exp(δθ),
 * δθ ~ N(0, R_body) — and then convert the result into the tutorial ZYX Euler
 * representation. To first order δe = W(φ, θ) δθ, so the filter uses
 * R_euler = W R_assumed Wᵀ at its estimate. Near gimbal lock this mapping blows up,
 * which is exactly why real flight software does not filter Euler angles.
 */
class StarTrackerSensor final : public Sensor {
 public:
  explicit StarTrackerSensor(SensorConfig cfg);
  std::string type() const override { return "star_tracker"; }
  int dim() const override { return 3; }
  std::vector<ComponentLabel> labels() const override;
  std::string unsupported_reason(const DynamicsModel& model) const override;
  Vec h(double t, const Vec& x) const override;
  Mat H(double t, const Vec& x) const override;
  bool is_linear() const override { return true; }
  Vec simulate(double t, const Vec& x_true, Rng& rng) const override;
  Mat filter_covariance(const Vec& x_est) const override;
};

}  // namespace osim
