#pragma once
/**
 * Interface every state-space model implements: ẋ = f(t, x, u) + G(t, x) w.
 *
 *   x : state (state_dim)          u : control input (control_dim), held constant over a step
 *   w : white process noise (noise_dim), with power spectral density Q_c
 *
 * Analytic partials are required so that estimators never need finite differences;
 * every implementation is checked against finite differences in tests/test_dynamics.cpp.
 */

#include "osim/types.hpp"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace osim {

class DynamicsModel {
 public:
  virtual ~DynamicsModel() = default;

  virtual std::string name() const = 0;
  virtual int state_dim() const = 0;
  virtual int control_dim() const = 0;
  virtual int noise_dim() const = 0;

  /// Rate of change of the state.
  virtual Vec f(double t, const Vec& x, const Vec& u) const = 0;
  /// A = ∂f/∂x.
  virtual Mat jacobian(double t, const Vec& x, const Vec& u) const = 0;
  /// B = ∂f/∂u (called process_noise_matrix G in the Python reference).
  virtual Mat control_matrix(double t, const Vec& x, const Vec& u) const = 0;
  /// G_w: maps the white process noise w into ẋ.
  virtual Mat noise_matrix(double t, const Vec& x) const = 0;

  /// a ⊖ b, with angle components wrapped into (-pi, pi].
  virtual Vec state_difference(const Vec& a, const Vec& b) const { return a - b; }
  /// Bring a state into its canonical range (e.g. wrap Euler angles).
  virtual Vec normalize(const Vec& x) const { return x; }

  /// True when f is linear in x and u, so that a standard KF is exact.
  virtual bool is_linear() const { return false; }
  /// True when the state contains attitude (Euler angles and body rates).
  virtual bool has_attitude() const { return false; }
  /// True when positions are ECI positions (ground stations need that).
  virtual bool is_inertial_orbit() const { return true; }

  virtual std::vector<ComponentLabel> state_labels() const = 0;
  virtual std::vector<ComponentLabel> control_labels() const = 0;
  virtual std::vector<ComponentLabel> noise_labels() const = 0;

  /// Non-empty while the state is near a representation singularity (gimbal lock).
  virtual std::string singularity_warning(const Vec&) const { return {}; }

  /// Number of f / jacobian evaluations: a machine-independent cost measure.
  std::uint64_t f_evaluations() const { return f_evals_; }
  std::uint64_t jacobian_evaluations() const { return jac_evals_; }
  void reset_counters() const { f_evals_ = jac_evals_ = 0; }

 protected:
  void count_f() const { ++f_evals_; }
  void count_jacobian() const { ++jac_evals_; }

 private:
  mutable std::uint64_t f_evals_ = 0;
  mutable std::uint64_t jac_evals_ = 0;
};

using DynamicsModelPtr = std::shared_ptr<const DynamicsModel>;

}  // namespace osim
