#include "osim/integrators/propagator.hpp"

#include <cmath>

namespace osim {

int substeps(double dt, double max_step) {
  if (!(max_step > 0.0)) throw ConfigError("Integrator step must be positive.");
  if (dt <= 0.0) return 0;
  return std::max(1, static_cast<int>(std::ceil(dt / max_step - 1e-9)));
}

Vec propagate(const DynamicsModel& model, double t0, const Vec& x0, const Vec& u, double dt,
              const IntegratorConfig& cfg) {
  const int N = substeps(dt, cfg.max_step);
  if (N == 0) return x0;
  const double T = dt / N;
  Vec x = x0;
  for (int k = 0; k < N; ++k) {
    const double t = t0 + k * T;
    x = cfg.method == IntegratorMethod::RK4 ? rk_four(model, t, x, u, T) : euler_int(model, t, x, u, T);
  }
  return x;
}

namespace {

// Derivative of the augmented state (x, Φ, Γ, Qw) at one stage
struct Aug {
  Vec x;
  Mat Phi, Gamma, Q;
};

Aug aug_rate(const DynamicsModel& model, double t, const Aug& s, const Vec& u, const Mat& Qc) {
  const Mat A = model.jacobian(t, s.x, u);
  const Mat B = model.control_matrix(t, s.x, u);
  const Mat G = model.noise_matrix(t, s.x);
  Aug d;
  d.x = model.f(t, s.x, u);
  d.Phi = A * s.Phi;
  d.Gamma = A * s.Gamma + B;
  d.Q = A * s.Q + s.Q * A.transpose() + G * Qc * G.transpose();
  return d;
}

Aug axpy(const Aug& s, double h, const Aug& d) {
  return {s.x + h * d.x, s.Phi + h * d.Phi, s.Gamma + h * d.Gamma, s.Q + h * d.Q};
}

}  // namespace

Propagation propagate_variational(const DynamicsModel& model, double t0, const Vec& x0,
                                  const Vec& u, double dt, const IntegratorConfig& cfg,
                                  const Mat& Qc, const Mat& Sigma_u) {
  const int n = model.state_dim();
  const int m = model.control_dim();
  if (Qc.rows() != model.noise_dim() || Qc.cols() != model.noise_dim())
    throw ConfigError("Process-noise PSD has the wrong dimension for model " + model.name() + ".");
  if (Sigma_u.rows() != m || Sigma_u.cols() != m)
    throw ConfigError("Control-noise covariance has the wrong dimension for model " + model.name() + ".");

  Aug s{x0, Mat::Identity(n, n), Mat::Zero(n, m), Mat::Zero(n, n)};
  const int N = substeps(dt, cfg.max_step);
  const double T = N > 0 ? dt / N : 0.0;
  for (int k = 0; k < N; ++k) {
    const double t = t0 + k * T;
    if (cfg.method == IntegratorMethod::RK4) {
      const Aug k_1 = aug_rate(model, t, s, u, Qc);
      const Aug k_2 = aug_rate(model, t + T / 2.0, axpy(s, T / 2.0, k_1), u, Qc);
      const Aug k_3 = aug_rate(model, t + T / 2.0, axpy(s, T / 2.0, k_2), u, Qc);
      const Aug k_4 = aug_rate(model, t + T, axpy(s, T, k_3), u, Qc);
      s.x += T / 6.0 * (k_1.x + 2.0 * k_2.x + 2.0 * k_3.x + k_4.x);
      s.Phi += T / 6.0 * (k_1.Phi + 2.0 * k_2.Phi + 2.0 * k_3.Phi + k_4.Phi);
      s.Gamma += T / 6.0 * (k_1.Gamma + 2.0 * k_2.Gamma + 2.0 * k_3.Gamma + k_4.Gamma);
      s.Q += T / 6.0 * (k_1.Q + 2.0 * k_2.Q + 2.0 * k_3.Q + k_4.Q);
    } else {
      const Aug k_1 = aug_rate(model, t, s, u, Qc);
      s = axpy(s, T, k_1);
    }
  }

  Propagation p;
  p.x = s.x;
  p.Phi = s.Phi;
  p.Gamma = s.Gamma;
  // Discrete process noise: continuous PSD part plus zero-order-hold control error
  p.Qd = s.Q + s.Gamma * Sigma_u * s.Gamma.transpose();
  // Numerically help the covariance matrix stay symmetric
  p.Qd = 0.5 * (p.Qd + p.Qd.transpose());
  return p;
}

}  // namespace osim
