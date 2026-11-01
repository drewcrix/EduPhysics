#include "osim/estimators/linear_kf.hpp"

#include "osim/estimators/covariance_utils.hpp"

namespace osim {

namespace {

/// ẋ = f₀ + A₀ (x − x₀) + B₀ u + G₀ w: the frozen linearisation of another model.
class AffineModel final : public DynamicsModel {
 public:
  AffineModel(const DynamicsModel& base, const Vec& x0)
      : base_name_(base.name()), x0_(x0), labels_(base.state_labels()), ulabels_(base.control_labels()),
        wlabels_(base.noise_labels()) {
    const Vec u0 = Vec::Zero(base.control_dim());
    f0_ = base.f(0.0, x0, u0);
    A0_ = base.jacobian(0.0, x0, u0);
    B0_ = base.control_matrix(0.0, x0, u0);
    G0_ = base.noise_matrix(0.0, x0);
  }
  std::string name() const override { return base_name_ + "-frozen"; }
  int state_dim() const override { return static_cast<int>(x0_.size()); }
  int control_dim() const override { return static_cast<int>(B0_.cols()); }
  int noise_dim() const override { return static_cast<int>(G0_.cols()); }
  Vec f(double, const Vec& x, const Vec& u) const override {
    count_f();
    return f0_ + A0_ * (x - x0_) + B0_ * u;
  }
  Mat jacobian(double, const Vec&, const Vec&) const override {
    count_jacobian();
    return A0_;
  }
  Mat control_matrix(double, const Vec&, const Vec&) const override { return B0_; }
  Mat noise_matrix(double, const Vec&) const override { return G0_; }
  bool is_linear() const override { return true; }
  std::vector<ComponentLabel> state_labels() const override { return labels_; }
  std::vector<ComponentLabel> control_labels() const override { return ulabels_; }
  std::vector<ComponentLabel> noise_labels() const override { return wlabels_; }

 private:
  std::string base_name_;
  Vec x0_, f0_;
  Mat A0_, B0_, G0_;
  std::vector<ComponentLabel> labels_, ulabels_, wlabels_;
};

}  // namespace

LinearKf::LinearKf(DynamicsModelPtr model, EstimatorSettings settings)
    : Estimator(std::move(model), std::move(settings)) {}

std::string LinearKf::display_name() const {
  if (model_->is_linear()) return "Kalman Filter (exact linear model)";
  return settings_.kf_linearization == KfLinearization::Reference ? "Linearized KF (reference trajectory)"
                                                                  : "Standard KF (frozen linearization)";
}

std::string LinearKf::unsupported_reason(const MeasurementModel& s) const {
  if (settings_.kf_linearization == KfLinearization::Frozen && !s.is_linear() && !model_->is_linear())
    return "The frozen-linearization KF only accepts measurements that are linear in the state. " +
           s.type() + " is nonlinear (range/angles); use the reference-trajectory KF or the EKF.";
  return {};
}

void LinearKf::initialize(double t0, const Vec& x0, const Mat& P0) {
  t_ = t0;
  x_ref_ = model_->normalize(x0);
  dx_ = Vec::Zero(x0.size());
  P_ = cov::symmetrize(P0);
  if (settings_.kf_linearization == KfLinearization::Frozen && !model_->is_linear())
    frozen_ = std::make_shared<AffineModel>(*model_, x_ref_);
}

Vec LinearKf::mean() const { return model_->normalize(x_ref_ + dx_); }

void LinearKf::predict(double t1, const Vec& u_m) {
  const double T = t1 - t_;
  if (T <= 0.0) return;
  const DynamicsModel& m = frozen_ ? *frozen_ : *model_;
  // Propagate the reference (or, in frozen mode, the affine model) and its transition matrix
  const Propagation p = propagate_variational(m, t_, x_ref_, u_m, T, settings_.integrator, settings_.Qc,
                                              settings_.Sigma_u);
  x_ref_ = p.x;
  // Deviation dynamics are linear: δx⁻ = Φ δx⁺
  dx_ = p.Phi * dx_;
  if (frozen_) {
    // In frozen mode the "reference" is the estimate itself; keep δx = 0
    x_ref_ += dx_;
    dx_.setZero();
  }
  P_ = cov::symmetrize(p.Phi * P_ * p.Phi.transpose() + p.Qd);
  t_ = t1;
}

UpdateResult LinearKf::update(const MeasurementModel& s, const Measurement& m) {
  if (auto why = unsupported_reason(s); !why.empty()) {
    UpdateResult r;
    r.status = UpdateResult::Status::Unsupported;
    r.message = why;
    return r;
  }
  // Linearise the measurement about the reference (exact for linear sensors)
  const Mat H = s.H(m.t, x_ref_);
  const Vec zpred = s.h(m.t, x_ref_) + H * dx_;
  const Vec nu = s.residual(m.z, zpred);
  const Mat R = s.filter_covariance(mean());
  // The deviation is a plain vector: it is not angle-normalised
  return kalman_update(nullptr, dx_, P_, nu, H, R, stats_);
}

void LinearKf::apply_impulse(const Vec3& dv, const Mat3& cov) {
  // A planned burn is part of the nominal: move the reference itself
  x_ref_.segment<3>(3) += dv;
  P_.block<3, 3>(3, 3) += cov;
}

}  // namespace osim
