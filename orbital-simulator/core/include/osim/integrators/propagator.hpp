#pragma once
/**
 * Propagation over an arbitrary interval with sub-steps, optionally together with the
 * variational equations used by the EKF.
 *
 * Augmented system, integrated with the *same* RK4 stages as the state:
 *
 *   ẋ  = f(x, u)
 *   Φ̇  = A Φ,                     Φ(t₀) = I      (state-transition matrix)
 *   Γ̇  = A Γ + B,                 Γ(t₀) = 0      (Γ = ∫ Φ(t,s) B ds, control sensitivity)
 *   Q̇w = A Qw + Qw Aᵀ + G Q_c Gᵀ, Qw(t₀) = 0     (Qw = ∫ Φ G Q_c Gᵀ Φᵀ ds)
 *
 * Because each stage of the variational RK4 is the derivative of the corresponding state
 * stage, Φ is exactly the Jacobian of the discrete RK4 map ("internal numerical
 * differentiation"), not merely an approximation of the continuous one.
 *
 * Discrete process noise: Q_d = Qw + Γ Σ_u Γᵀ, where Q_c is a continuous PSD (grows
 * linearly with elapsed time for small intervals) and Σ_u is the covariance of the
 * control telemetry error, which is held for the whole interval (zero-order hold, the
 * generalisation of L Q Lᵀ with L = T G in the Python reference).
 */

#include "osim/integrators/rk4.hpp"

namespace osim {

struct IntegratorConfig {
  IntegratorMethod method = IntegratorMethod::RK4;
  double max_step = 10.0;  // s; intervals are split into equal sub-steps no longer than this
};

struct Propagation {
  Vec x;      // propagated state
  Mat Phi;    // ∂x(t₁)/∂x(t₀)
  Mat Gamma;  // ∂x(t₁)/∂u
  Mat Qd;     // discrete process-noise covariance
};

/// Number of equal sub-steps used for an interval dt.
int substeps(double dt, double max_step);

/// Propagate the state only.
Vec propagate(const DynamicsModel& model, double t0, const Vec& x0, const Vec& u, double dt,
              const IntegratorConfig& cfg);

/// Propagate state, Φ, Γ and Q_d together. Qc is noise_dim×noise_dim, Sigma_u control_dim².
Propagation propagate_variational(const DynamicsModel& model, double t0, const Vec& x0,
                                  const Vec& u, double dt, const IntegratorConfig& cfg,
                                  const Mat& Qc, const Mat& Sigma_u);

}  // namespace osim
