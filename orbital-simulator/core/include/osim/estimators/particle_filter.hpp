#pragma once
/**
 * Bootstrap (sequential importance resampling) particle filter.
 *
 * - Prediction: every particle is propagated through the nonlinear dynamics and receives
 *   an independent process-noise sample w ~ N(0, Q_d), with Q_d from the variational
 *   equations at the weighted mean (an approximation that keeps cost linear in N).
 * - Weighting: log-likelihood log N(z ⊖ h(xᵢ); 0, R), accumulated in log space and
 *   normalised with log-sum-exp so that tiny likelihoods do not underflow.
 * - Resampling: systematic resampling when ESS = 1/Σwᵢ² < threshold · N, followed by
 *   optional roughening with the optimal Gaussian-kernel bandwidth
 *   h = (4 / (N (n + 2)))^{1/(n+4)} to counter sample impoverishment.
 * - Degeneracy safeguard: when ESS < 2n + 1 the weighted sample covariance is rank
 *   deficient, so the roughening kernel switches to the Gaussian-approximation posterior
 *   (Kalman update of the particle mean/covariance) with bandwidth 1. Counted and reported.
 * - Collapse safeguard: if *no* particle is statistically compatible with a measurement
 *   (smallest Mahalanobis distance above the χ² 1−10⁻⁶ quantile), the prior covariance is
 *   inflated by max(1, NIS/m) and the cloud is re-seeded from a Gaussian Kalman update. This makes the filter a
 *   pragmatic hybrid at that instant; every such event is counted and reported.
 *
 * Randomness comes from keyed streams (seed, "pf-…", counter): replays are bit-identical.
 */

#include "osim/estimators/estimator.hpp"

namespace osim {

class ParticleFilter final : public Estimator {
 public:
  ParticleFilter(DynamicsModelPtr model, EstimatorSettings settings);
  std::string type() const override { return "pf"; }
  std::string display_name() const override { return "Particle Filter"; }
  void initialize(double t0, const Vec& x0, const Mat& P0) override;
  void predict(double t1, const Vec& u_m) override;
  UpdateResult update(const MeasurementModel& s, const Measurement& m) override;
  void apply_impulse(const Vec3& dv, const Mat3& cov) override;
  Vec mean() const override;
  Mat covariance() const override;

  const Mat& particles() const { return X_; }
  Vec weights() const;
  double effective_sample_size() const;

 private:
  void normalize_log_weights();
  void resample(std::uint64_t counter, const Mat& P_kernel, double h_scale);
  void reseed_gaussian(const Vec& x, const Mat& P, std::uint64_t counter);
  Mat X_;      // particles (columns)
  Vec logw_;   // normalised log-weights
  std::uint64_t n_predict_ = 0, n_update_ = 0, n_impulse_ = 0;
};

}  // namespace osim
