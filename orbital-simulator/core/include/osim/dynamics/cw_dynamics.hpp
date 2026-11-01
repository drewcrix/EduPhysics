#pragma once
/**
 * Clohessy–Wiltshire (Hill) relative motion: an honestly linear teaching model.
 *
 * State x = [δx, δy, δz, δẋ, δẏ, δż] of a deputy relative to a chief on a circular orbit
 * with mean motion n, in the chief's LVLH frame (x radial, y along-track, z cross-track):
 *
 *   δẍ = 3n² δx + 2n δẏ + u_x
 *   δÿ = −2n δẋ          + u_y
 *   δz̈ = −n² δz          + u_z
 *
 * These equations are themselves linear (they are the linearisation of two-body relative
 * motion), so when truth and filter both use them a standard Kalman filter is exact.
 */

#include "osim/dynamics/dynamics_model.hpp"

namespace osim {

class ClohessyWiltshireDynamics final : public DynamicsModel {
 public:
  explicit ClohessyWiltshireDynamics(double mean_motion);

  std::string name() const override { return "cw6"; }
  int state_dim() const override { return 6; }
  int control_dim() const override { return 3; }
  int noise_dim() const override { return 3; }

  Vec f(double t, const Vec& x, const Vec& u) const override;
  Mat jacobian(double t, const Vec& x, const Vec& u) const override;
  Mat control_matrix(double t, const Vec& x, const Vec& u) const override;
  Mat noise_matrix(double t, const Vec& x) const override;

  bool is_linear() const override { return true; }
  bool is_inertial_orbit() const override { return false; }

  std::vector<ComponentLabel> state_labels() const override;
  std::vector<ComponentLabel> control_labels() const override;
  std::vector<ComponentLabel> noise_labels() const override;

  double mean_motion() const { return n_; }

 private:
  double n_;
  Mat A_;
};

}  // namespace osim
