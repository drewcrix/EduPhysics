// Integrators: analytic orbit references, conservation laws, convergence order, the
// variational STM (vs finite differences of the RK4 map and the closed-form CW STM) and
// the elapsed-time dependence of the discrete process noise.

#include "test_helpers.hpp"

#include "osim/dynamics/cw_dynamics.hpp"
#include "osim/dynamics/orbital_dynamics.hpp"
#include "osim/frames/frames.hpp"
#include "osim/integrators/propagator.hpp"

#include <unsupported/Eigen/MatrixFunctions>

#include <cmath>

using namespace osim;
using namespace osim::test;
using constants::MU_EARTH;

namespace {

OrbitalDynamics two_body() { return OrbitalDynamics({std::make_shared<PointMassGravity>(MU_EARTH)}); }

/// Independent analytic Kepler propagation (solve M = E − e sin E by Newton iteration).
Vec kepler_analytic(const frames::KeplerianElements& k0, double t) {
  const double n = std::sqrt(MU_EARTH / (k0.a * k0.a * k0.a));
  const double E0 = 2.0 * std::atan(std::sqrt((1 - k0.e) / (1 + k0.e)) * std::tan(k0.nu / 2));
  const double M = E0 - k0.e * std::sin(E0) + n * t;
  double E = M;
  for (int i = 0; i < 50; ++i) E -= (E - k0.e * std::sin(E) - M) / (1 - k0.e * std::cos(E));
  frames::KeplerianElements k = k0;
  k.nu = 2.0 * std::atan(std::sqrt((1 + k0.e) / (1 - k0.e)) * std::tan(E / 2));
  return frames::keplerian_to_cartesian(k, MU_EARTH);
}

}  // namespace

TEST_CASE("circular orbit matches the analytic solution") {
  const auto m = two_body();
  const double a = constants::R_EARTH + 550e3;
  const double v = std::sqrt(MU_EARTH / a), n = v / a;
  Vec x(6);
  x << a, 0, 0, 0, v, 0;  // same initial condition as orbital_ekf.py
  IntegratorConfig cfg{IntegratorMethod::RK4, 10.0};
  const double P = frames::orbital_period(a, MU_EARTH);
  for (double t : {600.0, 1800.0, P}) {
    const Vec y = propagate(m, 0, x, Vec::Zero(3), t, cfg);
    const Vec3 r_ref(a * std::cos(n * t), a * std::sin(n * t), 0.0);
    CHECK((y.head<3>() - r_ref).norm() < 0.05);  // metres, RK4 with a 10 s step
  }
}

TEST_CASE("elliptical orbit matches analytic Kepler propagation") {
  const auto m = two_body();
  frames::KeplerianElements k{constants::R_EARTH + 2250e3, 0.2027, 63.4 * constants::DEG, 0.5, 4.7, 0.3};
  const Vec x0 = frames::keplerian_to_cartesian(k, MU_EARTH);
  IntegratorConfig cfg{IntegratorMethod::RK4, 5.0};
  for (double t : {1000.0, 4000.0, 9000.0}) {
    const Vec y = propagate(m, 0, x0, Vec::Zero(3), t, cfg);
    CHECK((y.head<3>() - kepler_analytic(k, t).head<3>()).norm() < 0.5);
  }
}

TEST_CASE("unforced two-body motion conserves energy and angular momentum") {
  const auto m = two_body();
  frames::KeplerianElements k{constants::R_EARTH + 2250e3, 0.2027, 1.1, 0.5, 4.7, 0.0};
  const Vec x0 = frames::keplerian_to_cartesian(k, MU_EARTH);
  const double e0 = frames::specific_energy(x0, MU_EARTH);
  const Vec3 h0 = frames::angular_momentum(x0);
  const double P = frames::orbital_period(k.a, MU_EARTH);
  Vec x = x0;
  IntegratorConfig cfg{IntegratorMethod::RK4, 10.0};
  double worst_e = 0, worst_h = 0;
  for (int orbit = 0; orbit < 5; ++orbit) {
    x = propagate(m, 0, x, Vec::Zero(3), P, cfg);
    worst_e = std::max(worst_e, std::abs(frames::specific_energy(x, MU_EARTH) / e0 - 1.0));
    worst_h = std::max(worst_h, (frames::angular_momentum(x) - h0).norm() / h0.norm());
  }
  CHECK(worst_e < 1e-9);
  CHECK(worst_h < 1e-9);
  CHECK(x.allFinite());
}

TEST_CASE("RK4 converges at fourth order and Euler at first order") {
  const auto m = two_body();
  const double a = constants::R_EARTH + 550e3, v = std::sqrt(MU_EARTH / a), n = v / a, t = 2000.0;
  Vec x(6);
  x << a, 0, 0, 0, v, 0;
  const Vec3 r_ref(a * std::cos(n * t), a * std::sin(n * t), 0.0);
  auto err = [&](IntegratorMethod meth, double h) {
    return (propagate(m, 0, x, Vec::Zero(3), t, {meth, h}).head<3>() - r_ref).norm();
  };
  const double r4 = err(IntegratorMethod::RK4, 40.0) / err(IntegratorMethod::RK4, 20.0);
  CHECK(r4 > 13.0);  // ideal 2⁴ = 16
  CHECK(r4 < 19.0);
  const double r1 = err(IntegratorMethod::Euler, 0.5) / err(IntegratorMethod::Euler, 0.25);
  CHECK(r1 > 1.8);  // ideal 2
  CHECK(r1 < 2.2);
  MESSAGE("RK4 halving ratio " << r4 << ", Euler halving ratio " << r1);
}

TEST_CASE("variational STM equals the Jacobian of the discrete RK4 map") {
  const auto m = two_body();
  frames::KeplerianElements k{constants::R_EARTH + 800e3, 0.05, 1.0, 0.2, 0.3, 0.4};
  const Vec x0 = frames::keplerian_to_cartesian(k, MU_EARTH);
  IntegratorConfig cfg{IntegratorMethod::RK4, 10.0};
  const double dt = 60.0;  // six RK4 sub-steps
  const Mat Z3 = Mat::Zero(3, 3);
  const Propagation p = propagate_variational(m, 0, x0, Vec::Zero(3), dt, cfg, Z3, Z3);
  CHECK((p.x - propagate(m, 0, x0, Vec::Zero(3), dt, cfg)).norm() == doctest::Approx(0.0));
  // Large steps keep finite-difference round-off small relative to 7×10⁶ m positions;
  // the map is smooth, so truncation error is still negligible at this step size.
  Vec h(6);
  h << 10.0, 10.0, 10.0, 1e-2, 1e-2, 1e-2;
  const Mat Phi_fd = fd_jacobian([&](const Vec& y) { return propagate(m, 0, y, Vec::Zero(3), dt, cfg); }, x0, h);
  CHECK((p.Phi - Phi_fd).cwiseAbs().maxCoeff() < 1e-6);
  // The first-order approximation used in the Python reference (I + T A) is much worse
  const Mat F1 = Mat::Identity(6, 6) + dt * m.jacobian(0, x0, Vec::Zero(3));
  CHECK(rel_err(F1, Phi_fd) > 10.0 * rel_err(p.Phi, Phi_fd));
}

TEST_CASE("variational STM matches the closed-form Clohessy-Wiltshire STM") {
  const double n = 1.1e-3, t = 900.0;
  ClohessyWiltshireDynamics m(n);
  const Mat Z3 = Mat::Zero(3, 3);
  const Propagation p = propagate_variational(m, 0, Vec::Zero(6), Vec::Zero(3), t, {IntegratorMethod::RK4, 10.0}, Z3, Z3);
  const double s = std::sin(n * t), c = std::cos(n * t);
  Mat Phi(6, 6);
  Phi << 4 - 3 * c, 0, 0, s / n, 2 * (1 - c) / n, 0,
         6 * (s - n * t), 1, 0, -2 * (1 - c) / n, (4 * s - 3 * n * t) / n, 0,
         0, 0, c, 0, 0, s / n,
         3 * n * s, 0, 0, c, 2 * s, 0,
         -6 * n * (1 - c), 0, 0, -2 * s, 4 * c - 3, 0,
         0, 0, -n * s, 0, 0, c;
  CHECK(close(p.Phi, Phi, 1e-8, 1e-8));
}

TEST_CASE("discrete process noise matches Van Loan and scales correctly with elapsed time") {
  const double n = 1.1e-3, q = 2e-9;
  ClohessyWiltshireDynamics m(n);
  const Mat Qc = q * Mat::Identity(3, 3);
  const Mat Su = Mat::Zero(3, 3);
  for (double T : {10.0, 100.0, 600.0}) {
    const Propagation p = propagate_variational(m, 0, Vec::Zero(6), Vec::Zero(3), T, {IntegratorMethod::RK4, 10.0}, Qc, Su);
    // Van Loan (1978): exp([[-A, G Qc Gᵀ], [0, Aᵀ]] T) = [[·, Φ⁻¹ Qd], [0, Φᵀ]]
    const Mat A = m.jacobian(0, Vec::Zero(6), Vec::Zero(3));
    const Mat G = m.noise_matrix(0, Vec::Zero(6));
    Mat M = Mat::Zero(12, 12);
    M.topLeftCorner(6, 6) = -A * T;
    M.topRightCorner(6, 6) = G * Qc * G.transpose() * T;
    M.bottomRightCorner(6, 6) = A.transpose() * T;
    const Mat E = M.exp();
    const Mat Phi = E.bottomRightCorner(6, 6).transpose();
    const Mat Qd = Phi * E.topRightCorner(6, 6);
    // Qd's leading term is O(T³) while RK4's local error is O(T⁵), so the relative error is
    // O((nT)²) per step — about 5e-5 for a 10 s step in LEO (negligible for a tuning matrix)
    CHECK(rel_err(p.Qd, Qd) < 1e-4);
  }
  // For short intervals the velocity block grows linearly and position block cubically
  const auto Qd_at = [&](double T) {
    return propagate_variational(m, 0, Vec::Zero(6), Vec::Zero(3), T, {IntegratorMethod::RK4, 1.0}, Qc, Su).Qd;
  };
  const Mat q1 = Qd_at(1.0), q2 = Qd_at(2.0);
  CHECK(q2(3, 3) / q1(3, 3) == doctest::Approx(2.0).epsilon(1e-3));
  CHECK(q2(0, 0) / q1(0, 0) == doctest::Approx(8.0).epsilon(1e-3));
  CHECK(q1(3, 3) == doctest::Approx(q * 1.0).epsilon(1e-3));
  CHECK(q1(0, 0) == doctest::Approx(q / 3.0).epsilon(1e-3));
}

TEST_CASE("control-noise term generalises the reference L Q Lᵀ with L = T G") {
  const auto m = two_body();
  const double a = constants::R_EARTH + 550e3, v = std::sqrt(MU_EARTH / a);
  Vec x(6);
  x << a, 0, 0, 0, v, 0;
  const double T = 0.01;
  const Mat Su = 1e-4 * Mat::Identity(3, 3);
  const Propagation p = propagate_variational(m, 0, x, Vec::Zero(3), T, {IntegratorMethod::RK4, T}, Mat::Zero(3, 3), Su);
  const Mat L = T * m.control_matrix(0, x, Vec::Zero(3));
  // Agrees with the Python model in the velocity block for small T; also adds the T²/2 position coupling
  CHECK(p.Qd.bottomRightCorner(3, 3).isApprox((L * Su * L.transpose()).bottomRightCorner(3, 3), 1e-6));
}

TEST_CASE("sub-stepping splits intervals into equal steps") {
  CHECK(substeps(100.0, 10.0) == 10);
  CHECK(substeps(95.0, 10.0) == 10);
  CHECK(substeps(10.0, 10.0) == 1);
  CHECK(substeps(0.0, 10.0) == 0);
  CHECK_THROWS_AS(substeps(1.0, 0.0), ConfigError);
  const auto m = two_body();
  Vec x(6);
  x << 7e6, 0, 0, 0, 7546, 0;
  Vec y = x;
  for (int i = 0; i < 10; ++i) y = rk_four(m, i * 10.0, y, Vec::Zero(3), 10.0);
  CHECK((propagate(m, 0, x, Vec::Zero(3), 100.0, {IntegratorMethod::RK4, 10.0}) - y).norm() == 0.0);
}
