#pragma once
/**
 * 12-state rigid spacecraft, following the user's Python Satallite_Orbiter model:
 *
 *   x = [r_ECI (3), v_ECI (3), φ θ ψ (ZYX Euler, 3), ω_body (3)]
 *   u = [T (N, along body x through the centre of mass), τx τy τz (N·m, body axes)]
 *   w = [a_w (3, ECI unmodelled acceleration), α_w (3, body angular acceleration)]
 *
 *   ṙ = v
 *   v̇ = Σ a_i(r, v) + (T/m) C(e) e₁ + a_w
 *   ė = W(φ, θ) ω
 *   ω̇ = I⁻¹ (τ − ω × I ω) + α_w
 *
 * Mass and inertia are constant. With the default uniform sphere (I = 0.4 m R² for all
 * axes) the gyroscopic term ω × Iω vanishes and ω̇ = τ / I exactly as in model.py; a
 * general diagonal inertia is supported and its extra partials are included.
 */

#include "osim/dynamics/dynamics_model.hpp"
#include "osim/dynamics/force_model.hpp"

namespace osim {

struct RigidBodyParameters {
  double mass = 100.0;                       // kg
  Vec3 inertia = Vec3::Constant(0.4 * 100.0 * 0.25);  // principal inertia, kg·m²
};

/// Uniform solid sphere: I = 0.4 m R² about every axis.
RigidBodyParameters sphere_parameters(double mass, double radius);

class RigidSpacecraftDynamics final : public DynamicsModel {
 public:
  RigidSpacecraftDynamics(std::vector<ForceModelPtr> forces, RigidBodyParameters params);

  std::string name() const override { return "rigid12"; }
  int state_dim() const override { return 12; }
  int control_dim() const override { return 4; }
  int noise_dim() const override { return 6; }

  Vec f(double t, const Vec& x, const Vec& u) const override;
  Mat jacobian(double t, const Vec& x, const Vec& u) const override;
  Mat control_matrix(double t, const Vec& x, const Vec& u) const override;
  Mat noise_matrix(double t, const Vec& x) const override;

  Vec state_difference(const Vec& a, const Vec& b) const override;
  Vec normalize(const Vec& x) const override;
  bool has_attitude() const override { return true; }

  std::vector<ComponentLabel> state_labels() const override;
  std::vector<ComponentLabel> control_labels() const override;
  std::vector<ComponentLabel> noise_labels() const override;
  std::string singularity_warning(const Vec& x) const override;

  const RigidBodyParameters& parameters() const { return params_; }

 private:
  std::vector<ForceModelPtr> forces_;
  RigidBodyParameters params_;
};

}  // namespace osim
