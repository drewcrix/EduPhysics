// Dynamics models: analytic Jacobians against finite differences, an independent
// re-derivation of the Python reference equations, and Euler-angle guardrails.

#include "test_helpers.hpp"

#include "osim/dynamics/cw_dynamics.hpp"
#include "osim/dynamics/orbital_dynamics.hpp"
#include "osim/dynamics/rigid_spacecraft_dynamics.hpp"
#include "osim/frames/attitude.hpp"
#include "osim/rng.hpp"

#include <cmath>

using namespace osim;
using namespace osim::test;
using constants::MU_EARTH;

namespace {

std::vector<ForceModelPtr> gravity() { return {std::make_shared<PointMassGravity>(MU_EARTH)}; }

Vec leo_state(Rng& rng) {
  Vec x(6);
  const Vec3 r = (6.9e6 + 2e5 * rng.normal()) * Vec3(rng.normal(), rng.normal(), rng.normal()).normalized();
  const Vec3 v = 7600.0 * r.cross(Vec3(rng.normal(), rng.normal(), rng.normal())).normalized();
  x << r, v;
  return x;
}

Vec rigid_state(Rng& rng) {
  Vec x(12);
  x.head<6>() = leo_state(rng);
  x.segment<3>(6) << 0.7 * rng.normal(), 0.5 * rng.normal(), 0.9 * rng.normal();
  x.segment<3>(9) << 0.02 * rng.normal(), 0.02 * rng.normal(), 0.02 * rng.normal();
  return x;
}

Vec fd_steps(const DynamicsModel& m) {
  Vec h(m.state_dim());
  const auto lab = m.state_labels();
  for (int i = 0; i < h.size(); ++i)
    h[i] = lab[i].quantity == Quantity::Position ? 1.0 : (lab[i].quantity == Quantity::Velocity ? 1e-3 : 1e-6);
  return h;
}

}  // namespace

TEST_CASE("orbit6 Jacobian matches central finite differences") {
  OrbitalDynamics m(gravity());
  Rng rng(1);
  for (int trial = 0; trial < 20; ++trial) {
    const Vec x = leo_state(rng);
    const Vec u = Vec::Zero(3);
    const Mat A = m.jacobian(0, x, u);
    const Mat Afd = fd_jacobian([&](const Vec& y) { return m.f(0, y, u); }, x, fd_steps(m));
    CHECK(close(A, Afd, 1e-6, 1e-12));
  }
}

TEST_CASE("rigid12 Jacobian and control matrix match finite differences (incl. gyroscopic terms)") {
  RigidBodyParameters p;
  p.mass = 120.0;
  p.inertia = Vec3(8.0, 11.0, 14.0);  // non-isotropic so ω × Iω ≠ 0
  RigidSpacecraftDynamics m(gravity(), p);
  Rng rng(2);
  for (int trial = 0; trial < 30; ++trial) {
    const Vec x = rigid_state(rng);
    Vec u(4);
    u << 40.0 * rng.uniform(), 0.05 * rng.normal(), 0.05 * rng.normal(), 0.05 * rng.normal();
    const Mat A = m.jacobian(0, x, u);
    const Mat Afd = fd_jacobian([&](const Vec& y) { return m.f(0, y, u); }, x, fd_steps(m));
    CHECK(close(A, Afd, 1e-5, 1e-11));
    const Mat B = m.control_matrix(0, x, u);
    const Mat Bfd = fd_jacobian([&](const Vec& w) { return m.f(0, x, w); }, u, Vec::Constant(4, 1e-3));
    CHECK(close(B, Bfd, 1e-6, 1e-12));
  }
}

TEST_CASE("cw6 Jacobian is the constant CW matrix") {
  ClohessyWiltshireDynamics m(1.1e-3);
  Rng rng(3);
  Vec x = Vec::Random(6) * 100.0;
  const Mat Afd = fd_jacobian([&](const Vec& y) { return m.f(0, y, Vec::Zero(3)); }, x, Vec::Constant(6, 1e-2));
  CHECK(rel_err(m.jacobian(0, x, Vec::Zero(3)), Afd) < 1e-9);
  CHECK(m.is_linear());
}

TEST_CASE("rigid12 reproduces the Python reference equations (independent re-derivation)") {
  // Re-implement Satallite_Orbiter.f from model.py literally and compare.
  const double mu = MU_EARTH, mass = 100.0, R = 0.5, I = 0.4 * mass * R * R;
  RigidSpacecraftDynamics m(gravity(), sphere_parameters(mass, R));
  Rng rng(4);
  for (int trial = 0; trial < 10; ++trial) {
    const Vec x = rigid_state(rng);
    Vec u(4);
    u << 50.0, 0.05, -0.03, 0.02;
    const double r = std::sqrt(x[0] * x[0] + x[1] * x[1] + x[2] * x[2]);
    Vec f(12);
    f[0] = x[3];
    f[1] = x[4];
    f[2] = x[5];
    f[3] = (-mu * x[0]) / (r * r * r) + (u[0] * std::cos(x[8]) * std::cos(x[7])) / mass;
    f[4] = (-mu * x[1]) / (r * r * r) + (u[0] * std::sin(x[8]) * std::cos(x[7])) / mass;
    f[5] = (-mu * x[2]) / (r * r * r) + (-1 * u[0] * std::sin(x[7])) / mass;
    f[6] = x[9] + (std::sin(x[6]) * std::tan(x[7]) * x[10]) + (std::cos(x[6]) * std::tan(x[7]) * x[11]);
    f[7] = std::cos(x[6]) * x[10] - std::sin(x[6]) * x[11];
    f[8] = (std::sin(x[6]) / std::cos(x[7])) * x[10] + (std::cos(x[6]) / std::cos(x[7])) * x[11];
    f[9] = u[1] / I;
    f[10] = u[2] / I;
    f[11] = u[3] / I;
    CHECK(rel_err(m.f(0, x, u), f) < 1e-13);
  }
}

TEST_CASE("Euler-angle guardrails at gimbal lock") {
  RigidSpacecraftDynamics m(gravity(), sphere_parameters(100.0, 0.5));
  Rng rng(5);
  Vec x = rigid_state(rng);
  x[7] = constants::PI / 2;  // exactly at the singularity
  const Vec f = m.f(0, x, Vec::Zero(4));
  CHECK(f.allFinite());
  CHECK(m.jacobian(0, x, Vec::Zero(4)).allFinite());
  CHECK_FALSE(m.singularity_warning(x).empty());
  x[7] = 0.3;
  CHECK(m.singularity_warning(x).empty());
}

TEST_CASE("normalize keeps the same attitude when pitch passes ±90°") {
  RigidSpacecraftDynamics m(gravity(), sphere_parameters(100.0, 0.5));
  Vec x = Vec::Zero(12);
  x.head<3>() << 7e6, 0, 0;
  x.segment<3>(6) << 0.4, 2.0, -0.7;  // pitch beyond +90°
  const Vec y = m.normalize(x);
  CHECK(std::abs(y[7]) <= constants::PI / 2 + 1e-15);
  CHECK(rel_err(attitude::euler_to_dcm(y.segment<3>(6)), attitude::euler_to_dcm(x.segment<3>(6))) < 1e-12);
  // state_difference wraps angle errors
  Vec a = y, b = y;
  a[8] = constants::PI - 0.01;
  b[8] = -constants::PI + 0.01;
  CHECK(std::abs(m.state_difference(a, b)[8] + 0.02) < 1e-12);
}

TEST_CASE("dimensions and labels are consistent") {
  OrbitalDynamics o(gravity());
  RigidSpacecraftDynamics r(gravity(), sphere_parameters(100.0, 0.5));
  ClohessyWiltshireDynamics c(1e-3);
  for (const DynamicsModel* m : std::initializer_list<const DynamicsModel*>{&o, &r, &c}) {
    CHECK(static_cast<int>(m->state_labels().size()) == m->state_dim());
    CHECK(static_cast<int>(m->control_labels().size()) == m->control_dim());
    CHECK(static_cast<int>(m->noise_labels().size()) == m->noise_dim());
    const Vec x = m->state_dim() == 12 ? Vec(Vec::Zero(12)) : Vec(Vec::Zero(6));
    Vec xx = x;
    xx[0] = 7e6;
    CHECK(m->noise_matrix(0, xx).rows() == m->state_dim());
    CHECK(m->noise_matrix(0, xx).cols() == m->noise_dim());
    CHECK(m->control_matrix(0, xx, Vec::Zero(m->control_dim())).cols() == m->control_dim());
  }
  // Units are SI
  CHECK(o.state_labels()[0].unit == "m");
  CHECK(o.state_labels()[3].unit == "m/s");
  CHECK(r.state_labels()[6].unit == "rad");
  CHECK(r.state_labels()[9].unit == "rad/s");
}

TEST_CASE("invalid physical parameters are rejected with a message") {
  CHECK_THROWS_AS(PointMassGravity(-1.0), ConfigError);
  RigidBodyParameters p;
  p.mass = 0.0;
  CHECK_THROWS_AS(RigidSpacecraftDynamics(gravity(), p), ConfigError);
  CHECK_THROWS_AS(ClohessyWiltshireDynamics(0.0), ConfigError);
}
