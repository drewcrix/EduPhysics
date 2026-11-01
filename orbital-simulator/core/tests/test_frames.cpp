// Frames and attitude: orthonormality, handedness, round trips and kinematics.

#include "test_helpers.hpp"

#include "osim/frames/attitude.hpp"
#include "osim/frames/frames.hpp"
#include "osim/rng.hpp"

#include <cmath>

using namespace osim;
using namespace osim::test;

TEST_CASE("wrap_angle maps into (-pi, pi]") {
  CHECK(wrap_angle(0.0) == 0.0);
  CHECK(wrap_angle(constants::PI) == doctest::Approx(constants::PI));
  CHECK(wrap_angle(-constants::PI) == doctest::Approx(constants::PI));
  CHECK(wrap_angle(3 * constants::PI + 0.1) == doctest::Approx(-constants::PI + 0.1));
  CHECK(wrap_angle(1e6) > -constants::PI);
  CHECK(wrap_angle(1e6) <= constants::PI);
}

TEST_CASE("Keplerian elements round-trip through Cartesian state") {
  frames::KeplerianElements k{8.0e6, 0.15, 0.9, 1.2, 2.1, 0.7};
  const Vec x = frames::keplerian_to_cartesian(k, constants::MU_EARTH);
  const auto k2 = frames::cartesian_to_keplerian(x, constants::MU_EARTH);
  CHECK(k2.a == doctest::Approx(k.a).epsilon(1e-12));
  CHECK(k2.e == doctest::Approx(k.e).epsilon(1e-10));
  CHECK(k2.i == doctest::Approx(k.i).epsilon(1e-12));
  CHECK(k2.raan == doctest::Approx(k.raan).epsilon(1e-12));
  CHECK(k2.argp == doctest::Approx(k.argp).epsilon(1e-9));
  CHECK(k2.nu == doctest::Approx(k.nu).epsilon(1e-9));
  // Vis-viva as an independent check
  const double r = x.head<3>().norm(), v = x.tail<3>().norm();
  CHECK(v * v == doctest::Approx(constants::MU_EARTH * (2 / r - 1 / k.a)).epsilon(1e-12));
}

TEST_CASE("RTN and ENU bases are orthonormal and right-handed") {
  Vec x(6);
  x << 6.9e6, 1e5, -3e5, 100, 7500, 1200;
  const Mat3 C = frames::rtn_basis(x.head<3>(), x.tail<3>());
  CHECK((C * C.transpose() - Mat3::Identity()).norm() < 1e-14);
  CHECK(C.determinant() == doctest::Approx(1.0));
  CHECK(C.row(0).dot(x.head<3>().normalized()) == doctest::Approx(1.0));
  const double lat = 0.6, lon = -1.9;
  const Mat3 E = frames::enu_basis_ecef(lat, lon);
  CHECK((E * E.transpose() - Mat3::Identity()).norm() < 1e-14);
  CHECK(E.determinant() == doctest::Approx(1.0));
  CHECK(E.row(2).dot(frames::geodetic_to_ecef(lat, lon, 0).normalized()) == doctest::Approx(1.0));
  const Vec3 g = frames::ecef_to_geodetic(frames::geodetic_to_ecef(lat, lon, 1234.0));
  CHECK(g[0] == doctest::Approx(lat));
  CHECK(g[1] == doctest::Approx(lon));
  CHECK(g[2] == doctest::Approx(1234.0).epsilon(1e-9));
}

TEST_CASE("Earth rotation: ECI to ECEF is a rotation about z at the sidereal rate") {
  const Mat3 R = frames::eci_to_ecef(86164.0905, 0.0);  // one sidereal day
  CHECK((R - Mat3::Identity()).norm() < 1e-4);
  const Mat3 Rq = frames::eci_to_ecef(86164.0905 / 4.0, 0.0);
  CHECK((Rq * Vec3::UnitX() - (-Vec3::UnitY())).norm() < 1e-4);
}

TEST_CASE("ZYX Euler, DCM and quaternion conversions agree") {
  Rng rng(11);
  for (int i = 0; i < 50; ++i) {
    const Vec3 e(rng.normal(), 0.6 * rng.normal(), rng.normal());
    Vec3 ew = e;
    ew[0] = wrap_angle(e[0]);
    ew[2] = wrap_angle(e[2]);
    if (std::abs(ew[1]) > 1.5) continue;
    const Mat3 C = attitude::euler_to_dcm(ew);
    CHECK((C * C.transpose() - Mat3::Identity()).norm() < 1e-14);
    CHECK(C.determinant() == doctest::Approx(1.0));
    CHECK((attitude::dcm_to_euler(C) - ew).norm() < 1e-12);
    CHECK((attitude::quaternion_to_euler(attitude::euler_to_quaternion(ew)) - ew).norm() < 1e-12);
    // Thrust axis used by the reference model
    const Vec3 bx(std::cos(ew[2]) * std::cos(ew[1]), std::sin(ew[2]) * std::cos(ew[1]), -std::sin(ew[1]));
    CHECK((C.col(0) - bx).norm() < 1e-14);
  }
}

TEST_CASE("Euler-rate kinematics agree with the body-frame DCM derivative") {
  // A small body rotation C ← C Exp(ω dt) changes the Euler angles by W(φ,θ) ω dt
  const Vec3 e(0.3, -0.4, 1.1), w(0.02, -0.01, 0.03);
  const double dt = 1e-6;
  const Vec3 e2 = attitude::dcm_to_euler(attitude::euler_to_dcm(e) * attitude::so3_exp(w * dt));
  CHECK(((e2 - e) / dt - attitude::euler_rate_matrix(e) * w).norm() < 1e-6);
  CHECK((attitude::so3_exp(Vec3(0, 0, constants::PI / 2)) * Vec3::UnitX() - Vec3::UnitY()).norm() < 1e-14);
}
