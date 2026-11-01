#include "osim/estimators/particle_filter.hpp"

#include "osim/diagnostics/statistics.hpp"
#include "osim/estimators/covariance_utils.hpp"
#include "osim/rng.hpp"

#include <cmath>
#include <limits>

namespace osim {

ParticleFilter::ParticleFilter(DynamicsModelPtr model, EstimatorSettings settings)
    : Estimator(std::move(model), std::move(settings)) {
  const auto& p = settings_.pf;
  if (p.particles < 10 || p.particles > 20000) throw ConfigError("Particle count must be between 10 and 20000.");
  if (!(p.resample_threshold > 0.0 && p.resample_threshold <= 1.0))
    throw ConfigError("Resampling threshold must be in (0, 1].");
  stats_.particles = p.particles;
}

void ParticleFilter::initialize(double t0, const Vec& x0, const Mat& P0) {
  t_ = t0;
  reseed_gaussian(model_->normalize(x0), cov::symmetrize(P0), 0);
}

void ParticleFilter::reseed_gaussian(const Vec& x, const Mat& P, std::uint64_t counter) {
  const int n = model_->state_dim(), N = settings_.pf.particles;
  Rng rng(settings_.seed, "pf-seed", counter);
  const Mat L = cov::safe_cholesky(P);
  X_.resize(n, N);
  for (int i = 0; i < N; ++i) X_.col(i) = model_->normalize(x + rng.gaussian(L));
  logw_ = Vec::Constant(N, -std::log(static_cast<double>(N)));
  stats_.ess = N;
}

Vec ParticleFilter::weights() const { return logw_.array().exp(); }

double ParticleFilter::effective_sample_size() const { return 1.0 / weights().squaredNorm(); }

void ParticleFilter::normalize_log_weights() {
  // log-sum-exp normalisation
  const double mx = logw_.maxCoeff();
  const double lse = mx + std::log((logw_.array() - mx).exp().sum());
  logw_.array() -= lse;
}

Vec ParticleFilter::mean() const {
  const Vec w = weights();
  Eigen::Index best;
  w.maxCoeff(&best);
  const Vec ref = X_.col(best);
  Vec d = Vec::Zero(X_.rows());
  for (int i = 0; i < X_.cols(); ++i) d += w[i] * model_->state_difference(X_.col(i), ref);
  return model_->normalize(ref + d);
}

Mat ParticleFilter::covariance() const {
  const Vec w = weights();
  const Vec mu = mean();
  Mat P = Mat::Zero(X_.rows(), X_.rows());
  for (int i = 0; i < X_.cols(); ++i) {
    const Vec d = model_->state_difference(X_.col(i), mu);
    P += w[i] * d * d.transpose();
  }
  return cov::symmetrize(P);
}

void ParticleFilter::predict(double t1, const Vec& u_m) {
  const double T = t1 - t_;
  if (T <= 0.0) return;
  ++n_predict_;
  const Propagation lin =
      propagate_variational(*model_, t_, mean(), u_m, T, settings_.integrator, settings_.Qc, settings_.Sigma_u);
  const Mat Lq = cov::safe_cholesky(lin.Qd);
  const bool noisy = lin.Qd.cwiseAbs().maxCoeff() > 0.0;
  Rng rng(settings_.seed, "pf-predict", n_predict_);
  for (int i = 0; i < X_.cols(); ++i) {
    Vec x = propagate(*model_, t_, X_.col(i), u_m, T, settings_.integrator);
    if (noisy) x += rng.gaussian(Lq);
    X_.col(i) = model_->normalize(x);
  }
  t_ = t1;
}

void ParticleFilter::resample(std::uint64_t counter, const Mat& P_kernel, double h_scale) {
  const int N = static_cast<int>(X_.cols());
  const Vec w = weights();
  Rng rng(settings_.seed, "pf-resample", counter);
  // Systematic resampling: one uniform offset, N evenly spaced pointers
  const double u0 = rng.uniform() / N;
  Mat Xn(X_.rows(), N);
  double cum = w[0];
  int j = 0;
  for (int i = 0; i < N; ++i) {
    const double u = u0 + static_cast<double>(i) / N;
    while (u > cum && j < N - 1) cum += w[++j];
    Xn.col(i) = X_.col(j);
  }
  X_ = Xn;
  logw_ = Vec::Constant(N, -std::log(static_cast<double>(N)));
  ++stats_.resamples;

  if (settings_.pf.roughening) {
    // Regularised PF: the kernel uses the weighted posterior covariance from *before*
    // resampling; the duplicated particles alone would underestimate the spread.
    const int n = static_cast<int>(X_.rows());
    const Mat& P = P_kernel;
    const double h = h_scale > 0.0 ? h_scale
                                   : settings_.pf.roughening_scale *
                                         std::pow(4.0 / (N * (n + 2.0)), 1.0 / (n + 4.0));  // optimal Gaussian kernel bandwidth
    const Mat L = cov::safe_cholesky(h * h * P + 1e-18 * Mat::Identity(n, n));
    Rng rr(settings_.seed, "pf-roughen", counter);
    for (int i = 0; i < N; ++i) X_.col(i) = model_->normalize(X_.col(i) + rr.gaussian(L));
  }
}

UpdateResult ParticleFilter::update(const MeasurementModel& s, const Measurement& m) {
  ++n_update_;
  const int N = static_cast<int>(X_.cols()), d = s.dim();
  const Vec mu_prior = mean();
  const Mat P_prior = covariance();
  const Mat R = s.filter_covariance(mu_prior);
  Eigen::LDLT<Mat> Rl(R);

  // Predicted measurements, prior-weighted mean and covariance (for the NIS diagnostic)
  const Vec w = weights();
  Mat Z(d, N);
  for (int i = 0; i < N; ++i) Z.col(i) = s.h(m.t, X_.col(i));
  Eigen::Index best;
  w.maxCoeff(&best);
  Vec dz = Vec::Zero(d);
  for (int i = 0; i < N; ++i) dz += w[i] * s.residual(Z.col(i), Z.col(best));
  const Vec zbar = Z.col(best) + dz;
  UpdateResult res;
  Mat S = R;
  for (int i = 0; i < N; ++i) {
    const Vec e = s.residual(Z.col(i), zbar);
    S += w[i] * e * e.transpose();
  }
  res.S = cov::symmetrize(S);
  res.innovation = s.residual(m.z, zbar);
  res.nis = res.innovation.dot(res.S.ldlt().solve(res.innovation));

  // Likelihood weighting in log space
  double d2min = std::numeric_limits<double>::infinity();
  for (int i = 0; i < N; ++i) {
    const Vec nu = s.residual(m.z, Z.col(i));
    const double d2 = nu.dot(Rl.solve(nu));
    d2min = std::min(d2min, d2);
    logw_[i] += -0.5 * d2;
  }

  if (!(d2min <= stats::chi2_quantile(1.0 - 1e-6, d))) {
    // Collapse: no particle explains the measurement. Inflate the prior until the innovation
    // is consistent (NIS/d ≤ 1), then re-seed from a Gaussian Kalman update.
    ++stats_.collapses;
    Vec x = mu_prior;
    Mat P = P_prior * std::max(1.0, res.nis / d);
    const Mat H = s.H(m.t, x);
    kalman_update(model_.get(), x, P, s.residual(m.z, s.h(m.t, x)), H, R, stats_);
    --stats_.updates;  // counted below
    reseed_gaussian(x, P, 1000000 + n_update_);
    res.message = "Particle cloud collapsed (no particle consistent with the measurement); "
                  "re-seeded from a Gaussian update.";
  } else {
    normalize_log_weights();
    stats_.ess = effective_sample_size();
    if (stats_.ess < settings_.pf.resample_threshold * N) {
      const int n = model_->state_dim();
      if (stats_.ess < 2.0 * n + 1.0) {
        // Too few effective samples to estimate an n×n covariance: the survivors span a
        // lower-dimensional subspace. Use the full-rank Gaussian-approximation posterior
        // as the kernel (bandwidth 1) so the cloud regains its spread in every direction.
        ++stats_.degeneracy_fallbacks;
        Vec xg = mu_prior;
        Mat Pg = P_prior;
        kalman_update(model_.get(), xg, Pg, s.residual(m.z, s.h(m.t, xg)), s.H(m.t, xg), R, stats_);
        --stats_.updates;
        resample(n_update_, Pg, 1.0);
      } else {
        resample(n_update_, covariance(), 0.0);
      }
    }
  }
  stats_.ess = effective_sample_size();
  ++stats_.updates;
  return res;
}

void ParticleFilter::apply_impulse(const Vec3& dv, const Mat3& cov) {
  ++n_impulse_;
  Rng rng(settings_.seed, "pf-impulse", n_impulse_);
  const Mat L = cov::safe_cholesky(cov);
  for (int i = 0; i < X_.cols(); ++i) X_.col(i).segment<3>(3) += dv + Vec3(rng.gaussian(L));
}

}  // namespace osim
