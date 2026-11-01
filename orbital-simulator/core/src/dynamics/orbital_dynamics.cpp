#include "osim/dynamics/orbital_dynamics.hpp"

namespace osim {

OrbitalDynamics::OrbitalDynamics(std::vector<ForceModelPtr> forces) : forces_(std::move(forces)) {
  if (forces_.empty()) throw ConfigError("An orbital model needs at least one force model.");
}

Vec OrbitalDynamics::f(double t, const Vec& x, const Vec& u) const {
  count_f();
  const Vec3 r = x.segment<3>(0);
  const Vec3 v = x.segment<3>(3);
  Vec3 a = u.head<3>();
  for (const auto& fm : forces_) a += fm->acceleration(t, r, v);

  Vec xdot(6);
  // Linear velocity
  xdot.segment<3>(0) = v;
  // Gravity (and any other force model) plus thrust acceleration
  xdot.segment<3>(3) = a;
  return xdot;
}

Mat OrbitalDynamics::jacobian(double t, const Vec& x, const Vec&) const {
  count_jacobian();
  const Vec3 r = x.segment<3>(0);
  const Vec3 v = x.segment<3>(3);
  Mat A = Mat::Zero(6, 6);
  A.block<3, 3>(0, 3) = Mat3::Identity();
  Mat3 da_dr, da_dv;
  for (const auto& fm : forces_) {
    fm->partials(t, r, v, da_dr, da_dv);
    A.block<3, 3>(3, 0) += da_dr;
    A.block<3, 3>(3, 3) += da_dv;
  }
  return A;
}

Mat OrbitalDynamics::control_matrix(double, const Vec&, const Vec&) const {
  Mat B = Mat::Zero(6, 3);
  B.block<3, 3>(3, 0) = Mat3::Identity();
  return B;
}

Mat OrbitalDynamics::noise_matrix(double, const Vec&) const {
  Mat G = Mat::Zero(6, 3);
  G.block<3, 3>(3, 0) = Mat3::Identity();
  return G;
}

std::vector<ComponentLabel> OrbitalDynamics::state_labels() const {
  return {{"x", "m", Quantity::Position},    {"y", "m", Quantity::Position},
          {"z", "m", Quantity::Position},    {"vx", "m/s", Quantity::Velocity},
          {"vy", "m/s", Quantity::Velocity}, {"vz", "m/s", Quantity::Velocity}};
}

std::vector<ComponentLabel> OrbitalDynamics::control_labels() const {
  return {{"ax", "m/s²", Quantity::Other}, {"ay", "m/s²", Quantity::Other}, {"az", "m/s²", Quantity::Other}};
}

std::vector<ComponentLabel> OrbitalDynamics::noise_labels() const {
  return {{"wx", "m²/s³", Quantity::Other}, {"wy", "m²/s³", Quantity::Other}, {"wz", "m²/s³", Quantity::Other}};
}

}  // namespace osim
