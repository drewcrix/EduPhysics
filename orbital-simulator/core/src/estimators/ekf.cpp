#include "osim/estimators/covariance_utils.hpp"
#include "osim/estimators/estimator.hpp"

namespace osim {

Estimator::Estimator(DynamicsModelPtr model, EstimatorSettings settings)
    : model_(std::move(model)), settings_(std::move(settings)) {
  const int p = model_->noise_dim(), m = model_->control_dim();
  if (settings_.Qc.size() == 0) settings_.Qc = Mat::Zero(p, p);
  if (settings_.Sigma_u.size() == 0) settings_.Sigma_u = Mat::Zero(m, m);
  set_process_noise(settings_.Qc);
  set_control_noise(settings_.Sigma_u);
}

void Estimator::set_process_noise(const Mat& Qc) {
  std::vector<std::string> units;
  for (const auto& l : model_->noise_labels()) units.push_back(l.unit);
  auto c = cov::validate(Qc, model_->noise_dim(), "Process-noise PSD Q", false, units);
  if (!c.ok) throw ConfigError(c.message);
  settings_.Qc = Qc;
}

void Estimator::set_control_noise(const Mat& Sigma_u) {
  auto c = cov::validate(Sigma_u, model_->control_dim(), "Control-noise covariance Σu", false);
  if (!c.ok) throw ConfigError(c.message);
  settings_.Sigma_u = Sigma_u;
}

UpdateResult kalman_update(const DynamicsModel* normalize_with, Vec& x, Mat& P, const Vec& nu, const Mat& H,
                           const Mat& R, EstimatorStats& stats) {
  UpdateResult res;
  res.innovation = nu;
  // Innovation covariance
  res.S = cov::symmetrize(H * P * H.transpose() + R);
  Eigen::LDLT<Mat> ldlt(res.S);
  if (ldlt.info() != Eigen::Success || !ldlt.isPositive()) {
    res.status = UpdateResult::Status::Failed;
    res.message = "Innovation covariance S is not positive definite; measurement skipped.";
    return res;
  }
  // Kalman gain K = P Hᵀ S⁻¹, computed with a solve instead of an explicit inverse
  const Mat K = ldlt.solve(H * P).transpose();
  res.nis = nu.dot(ldlt.solve(nu));
  // Compute the a posteriori estimate
  x = x + K * nu;
  if (normalize_with) x = normalize_with->normalize(x);
  P = cov::joseph_update(P, K, H, R);
  if (cov::min_eigenvalue(P) < 0.0) {
    bool rep = false;
    P = cov::psd_repair(P, 0.0, &rep);
    if (rep) ++stats.psd_repairs;
  }
  ++stats.updates;
  return res;
}

void Ekf::initialize(double t0, const Vec& x0, const Mat& P0) {
  t_ = t0;
  x_ = model_->normalize(x0);
  P_ = cov::symmetrize(P0);
}

void Ekf::predict(double t1, const Vec& u_m) {
  const double T = t1 - t_;
  if (T <= 0.0) return;
  // Compute a priori estimate: integrate the nonlinear model and its variational equations
  const Propagation p =
      propagate_variational(*model_, t_, x_, u_m, T, settings_.integrator, settings_.Qc, settings_.Sigma_u);
  x_ = model_->normalize(p.x);
  P_ = p.Phi * P_ * p.Phi.transpose() + p.Qd;
  // Numerically help the covariance matrix stay symmetric
  P_ = cov::symmetrize(P_);
  t_ = t1;
}

UpdateResult Ekf::update(const MeasurementModel& s, const Measurement& m) {
  // Define some matrices for the a posteriori step
  const Mat H = s.H(m.t, x_);
  const Vec nu = s.residual(m.z, s.h(m.t, x_));
  const Mat R = s.filter_covariance(x_);
  return kalman_update(model_.get(), x_, P_, nu, H, R, stats_);
}

void Ekf::apply_impulse(const Vec3& dv, const Mat3& cov) {
  x_.segment<3>(3) += dv;
  P_.block<3, 3>(3, 3) += cov;
}

}  // namespace osim
