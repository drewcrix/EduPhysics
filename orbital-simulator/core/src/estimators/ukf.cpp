#include "osim/estimators/ukf.hpp"

#include "osim/estimators/covariance_utils.hpp"

#include <cmath>

namespace osim {

Ukf::Ukf(DynamicsModelPtr model, EstimatorSettings settings) : Estimator(std::move(model), std::move(settings)) {
  const auto& u = settings_.ukf;
  const int n = model_->state_dim();
  if (!(u.alpha > 0.0 && u.alpha <= 1.0)) throw ConfigError("UKF alpha must be in (0, 1].");
  const double lambda = u.alpha * u.alpha * (n + u.kappa) - n;
  c_ = n + lambda;
  if (!(c_ > 0.0)) throw ConfigError("UKF scaling gives n + λ ≤ 0; increase alpha or kappa.");
  const int N = 2 * n + 1;
  Wm_ = Vec::Constant(N, 0.5 / c_);
  Wc_ = Wm_;
  Wm_[0] = lambda / c_;
  Wc_[0] = lambda / c_ + (1.0 - u.alpha * u.alpha + u.beta);
}

void Ukf::initialize(double t0, const Vec& x0, const Mat& P0) {
  t_ = t0;
  x_ = model_->normalize(x0);
  P_ = cov::symmetrize(P0);
}

Mat Ukf::sigma_points() const {
  const int n = model_->state_dim();
  bool jit = false;
  const Mat L = cov::safe_cholesky(c_ * P_, &jit);
  Mat X(n, 2 * n + 1);
  X.col(0) = x_;
  for (int i = 0; i < n; ++i) {
    X.col(1 + i) = model_->normalize(x_ + L.col(i));
    X.col(1 + n + i) = model_->normalize(x_ - L.col(i));
  }
  return X;
}

void Ukf::repair() {
  P_ = cov::symmetrize(P_);
  if (cov::min_eigenvalue(P_) < 0.0) {
    bool rep = false;
    P_ = cov::psd_repair(P_, 0.0, &rep);
    if (rep) ++stats_.psd_repairs;
  }
}

void Ukf::predict(double t1, const Vec& u_m) {
  const double T = t1 - t_;
  if (T <= 0.0) return;
  const int n = model_->state_dim();
  // Additive process noise from the linearised noise model at the mean
  const Propagation lin =
      propagate_variational(*model_, t_, x_, u_m, T, settings_.integrator, settings_.Qc, settings_.Sigma_u);

  // Propagate every sigma point through the nonlinear dynamics
  const Mat X = sigma_points();
  Mat Y(n, X.cols());
  for (int i = 0; i < X.cols(); ++i) Y.col(i) = propagate(*model_, t_, X.col(i), u_m, T, settings_.integrator);

  // Weighted mean, relative to the propagated central point for angle safety
  Vec dmean = Vec::Zero(n);
  for (int i = 0; i < Y.cols(); ++i) dmean += Wm_[i] * model_->state_difference(Y.col(i), Y.col(0));
  x_ = model_->normalize(Y.col(0) + dmean);

  Mat P = lin.Qd;
  for (int i = 0; i < Y.cols(); ++i) {
    const Vec d = model_->state_difference(Y.col(i), x_);
    P += Wc_[i] * d * d.transpose();
  }
  P_ = P;
  repair();
  t_ = t1;
}

UpdateResult Ukf::update(const MeasurementModel& s, const Measurement& m) {
  const int n = model_->state_dim();
  const int d = s.dim();
  const Mat X = sigma_points();
  Mat Z(d, X.cols());
  for (int i = 0; i < X.cols(); ++i) Z.col(i) = s.h(m.t, X.col(i));

  // Predicted measurement mean (angles relative to the central point)
  Vec dz = Vec::Zero(d);
  for (int i = 0; i < Z.cols(); ++i) dz += Wm_[i] * s.residual(Z.col(i), Z.col(0));
  const Vec zbar = Z.col(0) + dz;

  UpdateResult res;
  Mat S = s.filter_covariance(x_);
  Mat Pxz = Mat::Zero(n, d);
  for (int i = 0; i < X.cols(); ++i) {
    const Vec ez = s.residual(Z.col(i), zbar);
    const Vec ex = model_->state_difference(X.col(i), x_);
    S += Wc_[i] * ez * ez.transpose();
    Pxz += Wc_[i] * ex * ez.transpose();
  }
  res.S = cov::symmetrize(S);
  res.innovation = s.residual(m.z, zbar);
  Eigen::LDLT<Mat> ldlt(res.S);
  if (ldlt.info() != Eigen::Success || !ldlt.isPositive()) {
    res.status = UpdateResult::Status::Failed;
    res.message = "UKF innovation covariance is not positive definite; measurement skipped.";
    return res;
  }
  const Mat K = ldlt.solve(Pxz.transpose()).transpose();
  res.nis = res.innovation.dot(ldlt.solve(res.innovation));
  x_ = model_->normalize(x_ + K * res.innovation);
  P_ = P_ - K * res.S * K.transpose();
  repair();
  ++stats_.updates;
  return res;
}

void Ukf::apply_impulse(const Vec3& dv, const Mat3& cov) {
  x_.segment<3>(3) += dv;
  P_.block<3, 3>(3, 3) += cov;
}

}  // namespace osim
