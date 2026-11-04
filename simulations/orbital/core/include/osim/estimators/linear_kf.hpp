#pragma once
/**
 * Standard (linear) Kalman filter, in two clearly labelled forms. Neither is claimed to be
 * exact for nonlinear two-body motion; both are exact when the model itself is linear
 * (the Clohessy–Wiltshire lab).
 *
 * Reference (linearised KF, LKF): a nominal trajectory x_ref is propagated once from the
 *   initial estimate and never corrected. The filter estimates the deviation δx with
 *   δx⁻ = Φ_ref δx⁺ and z ≈ h(x_ref) + H(x_ref) δx. Accurate while the true deviation stays
 *   small; diverges when second-order terms grow (large initial errors, unmodelled burns).
 *
 * Frozen (time-invariant KF): the dynamics are linearised *once* about the initial
 *   estimate, ẋ ≈ f(x₀) + A₀ (x − x₀) + B₀ u, and that constant model is used forever.
 *   Because gravity's direction is frozen, the model is wrong after a small fraction of an
 *   orbit and the filter diverges while still reporting small uncertainty. That divergence
 *   is the point of the lesson. Only linear measurement models are accepted in this mode.
 */

#include "osim/estimators/estimator.hpp"

namespace osim {

class LinearKf final : public Estimator {
 public:
  LinearKf(DynamicsModelPtr model, EstimatorSettings settings);
  std::string type() const override { return "kf"; }
  std::string display_name() const override;
  void initialize(double t0, const Vec& x0, const Mat& P0) override;
  void predict(double t1, const Vec& u_m) override;
  UpdateResult update(const MeasurementModel& s, const Measurement& m) override;
  void apply_impulse(const Vec3& dv, const Mat3& cov) override;
  std::string unsupported_reason(const MeasurementModel& s) const override;
  Vec mean() const override;
  Mat covariance() const override { return P_; }

  KfLinearization linearization() const { return settings_.kf_linearization; }

 private:
  DynamicsModelPtr frozen_;  // affine model for the frozen mode
  Vec x_ref_;                // reference trajectory (Reference) or estimate (Frozen)
  Vec dx_;                   // deviation from the reference
  Mat P_;
};

}  // namespace osim
