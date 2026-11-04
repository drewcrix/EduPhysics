#include "osim/dynamics/cw_dynamics.hpp"

#include <cmath>

namespace osim {

ClohessyWiltshireDynamics::ClohessyWiltshireDynamics(double mean_motion) : n_(mean_motion) {
  if (!(n_ > 0.0) || !std::isfinite(n_)) throw ConfigError("CW mean motion must be positive.");
  A_ = Mat::Zero(6, 6);
  A_.block<3, 3>(0, 3) = Mat3::Identity();
  A_(3, 0) = 3.0 * n_ * n_;
  A_(3, 4) = 2.0 * n_;
  A_(4, 3) = -2.0 * n_;
  A_(5, 2) = -n_ * n_;
}

Vec ClohessyWiltshireDynamics::f(double, const Vec& x, const Vec& u) const {
  count_f();
  Vec xdot = A_ * x;
  xdot.segment<3>(3) += u.head<3>();
  return xdot;
}

Mat ClohessyWiltshireDynamics::jacobian(double, const Vec&, const Vec&) const {
  count_jacobian();
  return A_;
}

Mat ClohessyWiltshireDynamics::control_matrix(double, const Vec&, const Vec&) const {
  Mat B = Mat::Zero(6, 3);
  B.block<3, 3>(3, 0) = Mat3::Identity();
  return B;
}

Mat ClohessyWiltshireDynamics::noise_matrix(double t, const Vec& x) const {
  return control_matrix(t, x, Vec::Zero(3));
}

std::vector<ComponentLabel> ClohessyWiltshireDynamics::state_labels() const {
  return {{"δx (radial)", "m", Quantity::Position},     {"δy (along)", "m", Quantity::Position},
          {"δz (cross)", "m", Quantity::Position},      {"δẋ", "m/s", Quantity::Velocity},
          {"δẏ", "m/s", Quantity::Velocity},            {"δż", "m/s", Quantity::Velocity}};
}

std::vector<ComponentLabel> ClohessyWiltshireDynamics::control_labels() const {
  return {{"ax", "m/s²", Quantity::Other}, {"ay", "m/s²", Quantity::Other}, {"az", "m/s²", Quantity::Other}};
}

std::vector<ComponentLabel> ClohessyWiltshireDynamics::noise_labels() const {
  return {{"wx", "m²/s³", Quantity::Other}, {"wy", "m²/s³", Quantity::Other}, {"wz", "m²/s³", Quantity::Other}};
}

}  // namespace osim
