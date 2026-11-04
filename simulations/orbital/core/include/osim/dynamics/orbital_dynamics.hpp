#pragma once
/**
 * Translational orbit model (6 states): x = [r_ECI (m), v_ECI (m/s)].
 *
 *   ṙ = v
 *   v̇ = Σ a_i(t, r, v) + u + w
 *
 * u is a commanded/measured acceleration from thrust in ECI [m/s²] and w is white
 * acceleration noise with PSD q [m²/s³] per axis.
 */

#include "osim/dynamics/dynamics_model.hpp"
#include "osim/dynamics/force_model.hpp"

namespace osim {

class OrbitalDynamics final : public DynamicsModel {
 public:
  explicit OrbitalDynamics(std::vector<ForceModelPtr> forces);

  std::string name() const override { return "orbit6"; }
  int state_dim() const override { return 6; }
  int control_dim() const override { return 3; }
  int noise_dim() const override { return 3; }

  Vec f(double t, const Vec& x, const Vec& u) const override;
  Mat jacobian(double t, const Vec& x, const Vec& u) const override;
  Mat control_matrix(double t, const Vec& x, const Vec& u) const override;
  Mat noise_matrix(double t, const Vec& x) const override;

  std::vector<ComponentLabel> state_labels() const override;
  std::vector<ComponentLabel> control_labels() const override;
  std::vector<ComponentLabel> noise_labels() const override;

  const std::vector<ForceModelPtr>& forces() const { return forces_; }

 private:
  std::vector<ForceModelPtr> forces_;
};

}  // namespace osim
