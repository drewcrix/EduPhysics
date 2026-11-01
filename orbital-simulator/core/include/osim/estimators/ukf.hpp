#pragma once
/**
 * Unscented Kalman filter (scaled unscented transform, Wan & van der Merwe).
 *
 *   λ = α² (n + κ) − n,  sigma points x̂ ± columns of chol((n + λ) P)
 *   W_m0 = λ/(n+λ),  W_c0 = W_m0 + (1 − α² + β),  W_i = 1/(2(n+λ))
 *
 * Default α = 1, β = 2, κ = 0 gives λ = 0: all mean weights are non-negative and the
 * points sit at ±√n σ. The textbook α = 10⁻³ makes W_c0 ≈ −10⁶ for orbit-sized states and
 * routinely produces indefinite covariances in double precision, so it is offered but not
 * the default. Means of angle components are taken relative to the central sigma point.
 * Process noise is additive: Q_d is computed from the variational equations at the mean.
 */

#include "osim/estimators/estimator.hpp"

namespace osim {

class Ukf final : public Estimator {
 public:
  Ukf(DynamicsModelPtr model, EstimatorSettings settings);
  std::string type() const override { return "ukf"; }
  std::string display_name() const override { return "Unscented Kalman Filter"; }
  void initialize(double t0, const Vec& x0, const Mat& P0) override;
  void predict(double t1, const Vec& u_m) override;
  UpdateResult update(const MeasurementModel& s, const Measurement& m) override;
  void apply_impulse(const Vec3& dv, const Mat3& cov) override;
  Vec mean() const override { return x_; }
  Mat covariance() const override { return P_; }

  /// Sigma points (columns) for the current estimate; exposed for tests and plots.
  Mat sigma_points() const;
  const Vec& mean_weights() const { return Wm_; }
  const Vec& cov_weights() const { return Wc_; }

 private:
  void repair();
  Vec x_;
  Mat P_;
  Vec Wm_, Wc_;
  double c_ = 0.0;  // n + λ
};

}  // namespace osim
