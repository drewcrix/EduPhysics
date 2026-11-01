#pragma once
/**
 * Estimator interface shared by the EKF, UKF, particle filter and linear KF.
 *
 * Truth separation: an estimator receives only (a) the measured control u_m, (b)
 * measurements through the MeasurementModel interface (assumed noise only) and (c) the
 * commanded Δv of *known* maneuvers. No method takes the true state.
 */

#include "osim/dynamics/dynamics_model.hpp"
#include "osim/integrators/propagator.hpp"
#include "osim/sensors/sensor.hpp"

#include <cstdint>
#include <memory>
#include <string>

namespace osim {

struct UkfParams {
  double alpha = 1.0;  // spread of sigma points (1 keeps all weights non-negative with κ = 0)
  double beta = 2.0;   // prior-distribution term (2 is optimal for Gaussians)
  double kappa = 0.0;  // secondary scaling
};

struct PfParams {
  int particles = 500;
  double resample_threshold = 0.5;  // resample when ESS < threshold · N
  bool roughening = true;           // regularise after resampling to fight sample impoverishment
  double roughening_scale = 1.0;    // multiplies the optimal Gaussian-kernel bandwidth
};

enum class KfLinearization { Reference, Frozen };

struct EstimatorSettings {
  IntegratorConfig integrator;
  Mat Qc;        // continuous process-noise PSD (noise_dim × noise_dim)
  Mat Sigma_u;   // control-telemetry error covariance assumed by the filter (control_dim²)
  std::uint64_t seed = 1;  // used only by stochastic estimators (particle filter)
  UkfParams ukf;
  PfParams pf;
  KfLinearization kf_linearization = KfLinearization::Reference;
};

struct UpdateResult {
  enum class Status { Applied, Unsupported, Failed };
  Status status = Status::Applied;
  std::string message;   // explanation when not applied
  Vec innovation;        // z ⊖ h(x⁻)
  Mat S;                 // innovation covariance used by the filter
  double nis = 0.0;      // νᵀ S⁻¹ ν
};

struct EstimatorStats {
  double ess = -1.0;           // particle filter effective sample size (−1 if n/a)
  int particles = 0;
  long long resamples = 0;
  long long collapses = 0;     // particle-filter recoveries from likelihood collapse
  long long degeneracy_fallbacks = 0;  // particle-filter full-rank kernel fallbacks
  long long psd_repairs = 0;   // covariance eigenvalue clipping events
  long long updates = 0;
};

class Estimator {
 public:
  Estimator(DynamicsModelPtr model, EstimatorSettings settings);
  virtual ~Estimator() = default;

  virtual std::string type() const = 0;
  virtual std::string display_name() const = 0;

  /// Set the initial estimate at time t0.
  virtual void initialize(double t0, const Vec& x0, const Mat& P0) = 0;
  /// Prediction (time update) from the current time to t1 with measured control u_m.
  virtual void predict(double t1, const Vec& u_m) = 0;
  /// Measurement update with measurement m from model s.
  virtual UpdateResult update(const MeasurementModel& s, const Measurement& m) = 0;
  /// A known impulsive maneuver: commanded Δv and its assumed execution covariance.
  virtual void apply_impulse(const Vec3& dv, const Mat3& cov) = 0;

  /// Empty if this estimator can process the sensor, else a student-facing reason.
  virtual std::string unsupported_reason(const MeasurementModel&) const { return {}; }

  virtual Vec mean() const = 0;
  virtual Mat covariance() const = 0;
  double time() const { return t_; }
  const EstimatorStats& stats() const { return stats_; }
  const DynamicsModel& model() const { return *model_; }
  const EstimatorSettings& settings() const { return settings_; }
  void set_process_noise(const Mat& Qc);
  void set_control_noise(const Mat& Sigma_u);

 protected:
  DynamicsModelPtr model_;
  EstimatorSettings settings_;
  double t_ = 0.0;
  EstimatorStats stats_;
};

using EstimatorPtr = std::unique_ptr<Estimator>;

/// Extended Kalman filter: nonlinear mean propagation, variational Φ, Joseph update.
class Ekf final : public Estimator {
 public:
  using Estimator::Estimator;
  std::string type() const override { return "ekf"; }
  std::string display_name() const override { return "Extended Kalman Filter"; }
  void initialize(double t0, const Vec& x0, const Mat& P0) override;
  void predict(double t1, const Vec& u_m) override;
  UpdateResult update(const MeasurementModel& s, const Measurement& m) override;
  void apply_impulse(const Vec3& dv, const Mat3& cov) override;
  Vec mean() const override { return x_; }
  Mat covariance() const override { return P_; }

 private:
  Vec x_;
  Mat P_;
};

/// Shared Kalman measurement-update step used by the EKF, linear KF and PF safeguard.
/// If `normalize_with` is non-null the updated state is passed through its normalize().
UpdateResult kalman_update(const DynamicsModel* normalize_with, Vec& x, Mat& P, const Vec& nu, const Mat& H,
                           const Mat& R, EstimatorStats& stats);

}  // namespace osim
