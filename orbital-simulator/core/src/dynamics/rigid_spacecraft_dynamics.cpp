#include "osim/dynamics/rigid_spacecraft_dynamics.hpp"

#include "osim/constants.hpp"
#include "osim/frames/attitude.hpp"

#include <cmath>

namespace osim {

using attitude::safe_cos_pitch;

RigidBodyParameters sphere_parameters(double mass, double radius) {
  RigidBodyParameters p;
  p.mass = mass;
  p.inertia = Vec3::Constant(0.4 * mass * radius * radius);  // moment of inertia of a uniform sphere
  return p;
}

RigidSpacecraftDynamics::RigidSpacecraftDynamics(std::vector<ForceModelPtr> forces,
                                                 RigidBodyParameters params)
    : forces_(std::move(forces)), params_(params) {
  if (forces_.empty()) throw ConfigError("A rigid-body model needs at least one force model.");
  if (!(params_.mass > 0.0)) throw ConfigError("Spacecraft mass must be positive.");
  if (!(params_.inertia.minCoeff() > 0.0)) throw ConfigError("Principal moments of inertia must be positive.");
}

Vec RigidSpacecraftDynamics::f(double t, const Vec& x, const Vec& u) const {
  count_f();
  const double T = u[0];  // thrust (N)
  const Vec3 tau = u.segment<3>(1);  // torques (N·m)
  const Vec3 r = x.segment<3>(0);
  const Vec3 v = x.segment<3>(3);
  const Vec3 e = x.segment<3>(6);
  const Vec3 w = x.segment<3>(9);
  const double m = params_.mass;
  const Vec3& I = params_.inertia;

  Vec f = Vec::Zero(12);
  // Linear velocity
  f.segment<3>(0) = v;

  // Thrust and gravity acceleration; thrust acts along body x
  Vec3 a = Vec3::Zero();
  for (const auto& fm : forces_) a += fm->acceleration(t, r, v);
  const double cth = std::cos(e[1]), sth = std::sin(e[1]);
  const double cps = std::cos(e[2]), sps = std::sin(e[2]);
  a += (T / m) * Vec3(cps * cth, sps * cth, -sth);
  f.segment<3>(3) = a;

  // Euler rates
  f.segment<3>(6) = attitude::euler_rate_matrix(e) * w;

  // Angular acceleration from Euler's rotation equations
  const Vec3 Iw = I.cwiseProduct(w);
  f.segment<3>(9) = (tau - w.cross(Iw)).cwiseQuotient(I);
  return f;
}

Mat RigidSpacecraftDynamics::jacobian(double t, const Vec& x, const Vec& u) const {
  count_jacobian();
  const double T = u[0];
  const Vec3 r = x.segment<3>(0);
  const Vec3 v = x.segment<3>(3);
  const Vec3 w = x.segment<3>(9);
  const double m = params_.mass;
  const Vec3& I = params_.inertia;
  const double cph = std::cos(x[6]), sph = std::sin(x[6]);
  const double cth = safe_cos_pitch(x[7]), sth = std::sin(x[7]);
  const double tth = sth / cth;
  const double cps = std::cos(x[8]), sps = std::sin(x[8]);
  const double q = w[1], rr = w[2];

  Mat A = Mat::Zero(12, 12);

  // Linear velocity derivatives
  A.block<3, 3>(0, 3) = Mat3::Identity();

  // Gravity acceleration derivatives with respect to position and velocity
  Mat3 da_dr, da_dv;
  for (const auto& fm : forces_) {
    fm->partials(t, r, v, da_dr, da_dv);
    A.block<3, 3>(3, 0) += da_dr;
    A.block<3, 3>(3, 3) += da_dv;
  }

  // Thrust acceleration derivatives with respect to orientation (pitch and yaw)
  A(3, 7) = -(T / m) * cps * sth;
  A(3, 8) = -(T / m) * sps * cth;
  A(4, 7) = -(T / m) * sps * sth;
  A(4, 8) = (T / m) * cps * cth;
  A(5, 7) = -(T / m) * cth;

  // Euler rate derivatives with respect to orientation
  A(6, 6) = cph * tth * q - sph * tth * rr;
  A(6, 7) = (sph * q + cph * rr) / (cth * cth);
  A(7, 6) = -sph * q - cph * rr;
  A(8, 6) = (cph * q - sph * rr) / cth;
  A(8, 7) = (sph * q + cph * rr) * sth / (cth * cth);

  // Euler rate derivatives with respect to angular velocity
  A.block<3, 3>(6, 9) = attitude::euler_rate_matrix(x.segment<3>(6));

  // Angular acceleration derivatives: d/dω [ -I^-1 (ω × Iω) ] = -I^-1 ([ω×] I - [(Iω)×])
  const Mat3 Id = I.asDiagonal();
  const Mat3 dgyro = attitude::skew(w) * Id - attitude::skew(I.cwiseProduct(w));
  A.block<3, 3>(9, 9) = -(I.cwiseInverse().asDiagonal() * dgyro);
  return A;
}

Mat RigidSpacecraftDynamics::control_matrix(double, const Vec& x, const Vec&) const {
  // B = ∂f/∂u (process_noise_matrix in the Python reference)
  Mat B = Mat::Zero(12, 4);
  const double m = params_.mass;
  // Thrust acceleration
  B(3, 0) = std::cos(x[8]) * std::cos(x[7]) / m;
  B(4, 0) = std::sin(x[8]) * std::cos(x[7]) / m;
  B(5, 0) = -std::sin(x[7]) / m;
  // Angular acceleration
  B(9, 1) = 1.0 / params_.inertia[0];
  B(10, 2) = 1.0 / params_.inertia[1];
  B(11, 3) = 1.0 / params_.inertia[2];
  return B;
}

Mat RigidSpacecraftDynamics::noise_matrix(double, const Vec&) const {
  Mat G = Mat::Zero(12, 6);
  G.block<3, 3>(3, 0) = Mat3::Identity();
  G.block<3, 3>(9, 3) = Mat3::Identity();
  return G;
}

Vec RigidSpacecraftDynamics::state_difference(const Vec& a, const Vec& b) const {
  Vec d = a - b;
  for (int i = 6; i < 9; ++i) d[i] = wrap_angle(d[i]);
  return d;
}

Vec RigidSpacecraftDynamics::normalize(const Vec& x) const {
  Vec y = x;
  double phi = y[6], theta = wrap_angle(y[7]), psi = y[8];
  // Pitch past ±90° is the same attitude as (φ+π, π−θ, ψ+π)
  if (theta > constants::PI / 2) {
    theta = constants::PI - theta;
    phi += constants::PI;
    psi += constants::PI;
  } else if (theta < -constants::PI / 2) {
    theta = -constants::PI - theta;
    phi += constants::PI;
    psi += constants::PI;
  }
  y[6] = wrap_angle(phi);
  y[7] = theta;
  y[8] = wrap_angle(psi);
  return y;
}

std::string RigidSpacecraftDynamics::singularity_warning(const Vec& x) const {
  if (std::abs(std::cos(x[7])) < attitude::kGimbalCosWarn)
    return "Pitch is within 2.6° of ±90°: ZYX Euler angles are near gimbal lock, so roll and yaw "
           "are poorly defined and Euler-rate equations amplify errors. A quaternion attitude "
           "state removes this singularity.";
  return {};
}

std::vector<ComponentLabel> RigidSpacecraftDynamics::state_labels() const {
  return {{"x", "m", Quantity::Position},          {"y", "m", Quantity::Position},
          {"z", "m", Quantity::Position},          {"vx", "m/s", Quantity::Velocity},
          {"vy", "m/s", Quantity::Velocity},       {"vz", "m/s", Quantity::Velocity},
          {"φ (roll)", "rad", Quantity::Angle},    {"θ (pitch)", "rad", Quantity::Angle},
          {"ψ (yaw)", "rad", Quantity::Angle},     {"ωx", "rad/s", Quantity::AngularRate},
          {"ωy", "rad/s", Quantity::AngularRate},  {"ωz", "rad/s", Quantity::AngularRate}};
}

std::vector<ComponentLabel> RigidSpacecraftDynamics::control_labels() const {
  return {{"T", "N", Quantity::Other}, {"τx", "N·m", Quantity::Other},
          {"τy", "N·m", Quantity::Other}, {"τz", "N·m", Quantity::Other}};
}

std::vector<ComponentLabel> RigidSpacecraftDynamics::noise_labels() const {
  return {{"a_wx", "m²/s³", Quantity::Other},   {"a_wy", "m²/s³", Quantity::Other},
          {"a_wz", "m²/s³", Quantity::Other},   {"α_wx", "rad²/s³", Quantity::Other},
          {"α_wy", "rad²/s³", Quantity::Other}, {"α_wz", "rad²/s³", Quantity::Other}};
}

}  // namespace osim
