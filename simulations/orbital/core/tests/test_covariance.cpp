// Covariance handling: validation messages, Joseph form, PSD repair, and covariance
// symmetry/PSD/convergence along full runs of every estimator.

#include "test_helpers.hpp"

#include "osim/estimators/covariance_utils.hpp"
#include "osim/rng.hpp"

using namespace osim;
using namespace osim::test;

TEST_CASE("covariance validation gives specific messages") {
  Mat good(2, 2);
  good << 4, 1, 1, 9;
  CHECK(cov::validate(good, 2, "R", true).ok);
  CHECK_FALSE(cov::validate(good, 3, "R", true).ok);
  Mat asym = good;
  asym(0, 1) = 2;
  auto c = cov::validate(asym, 2, "R", true);
  CHECK_FALSE(c.ok);
  CHECK(c.message.find("not symmetric") != std::string::npos);
  Mat indef(2, 2);
  indef << 1, 2, 2, 1;  // |ρ| = 2 > 1
  c = cov::validate(indef, 2, "R", true);
  CHECK_FALSE(c.ok);
  CHECK(c.message.find("|ρ| > 1") != std::string::npos);
  Mat negdiag(2, 2);
  negdiag << -1, 0, 0, 1;
  CHECK_FALSE(cov::validate(negdiag, 2, "Q", false, {"m²", "m²"}).ok);
  Mat psd = Mat::Zero(2, 2);
  psd(0, 0) = 1;
  CHECK(cov::validate(psd, 2, "Q", false).ok);       // PSD allowed for Q
  CHECK_FALSE(cov::validate(psd, 2, "R", true).ok);  // R must be PD
  Mat nan = good;
  nan(1, 1) = std::nan("");
  CHECK_FALSE(cov::validate(nan, 2, "R", true).ok);
}

TEST_CASE("Joseph form equals the standard update for the optimal gain and stays PSD otherwise") {
  Rng rng(3);
  Mat A = Mat::Random(6, 6);
  const Mat P = A * A.transpose() + Mat::Identity(6, 6);
  Mat H = Mat::Zero(3, 6);
  H.leftCols(3).setIdentity();
  const Mat R = 0.5 * Mat::Identity(3, 3);
  const Mat S = H * P * H.transpose() + R;
  const Mat K = P * H.transpose() * S.inverse();
  const Mat Pstd = (Mat::Identity(6, 6) - K * H) * P;
  CHECK(close(cov::joseph_update(P, K, H, R), cov::symmetrize(Pstd), 1e-10, 1e-10));
  const Mat Kbad = 3.0 * K;  // suboptimal gain
  CHECK(cov::min_eigenvalue(cov::joseph_update(P, Kbad, H, R)) >= -1e-12);
}

TEST_CASE("PSD repair and safe Cholesky handle semidefinite matrices") {
  Mat P(3, 3);
  P << 1, 1, 0, 1, 1, 0, 0, 0, 2;  // singular
  bool jit = false;
  const Mat L = cov::safe_cholesky(P, &jit);
  CHECK(L.allFinite());
  CHECK((L * L.transpose() - P).norm() < 1e-6);
  Mat bad = P;
  bad(2, 2) = -0.5;
  bool rep = false;
  const Mat fixed = cov::psd_repair(bad, 0.0, &rep);
  CHECK(rep);
  CHECK(cov::min_eigenvalue(fixed) >= -1e-15);
}

TEST_CASE("every estimator keeps P symmetric and PSD at every node") {
  for (const std::string type : {"ekf", "ukf", "pf", "kf"}) {
    for (const std::string sc : {"first_fix", "sensor_geometry_orbit", "sensor_geometry_attitude"}) {
      auto j = scenario_json(sc);
      j["estimator"]["type"] = type;
      if (type == "pf") j["estimator"]["pf"]["particles"] = 300;
      j["duration"] = sc == "sensor_geometry_attitude" ? 300 : 1500;
      Simulation sim = Simulation::from_json(j);
      sim.run_to_end();
      double worst_asym = 0, worst_eig = 0;
      for (const auto& r : sim.history()) {
        const double scale = r.P.cwiseAbs().maxCoeff();
        worst_asym = std::max(worst_asym, (r.P - r.P.transpose()).cwiseAbs().maxCoeff() / scale);
        worst_eig = std::min(worst_eig, cov::min_eigenvalue(r.P) / scale);
        REQUIRE(r.P.allFinite());
      }
      CAPTURE(type);
      CAPTURE(sc);
      CHECK(worst_asym < 1e-12);
      CHECK(worst_eig > -1e-12);
    }
  }
}

TEST_CASE("EKF covariance converges to a steady state with regular measurements") {
  auto j = scenario_json("first_fix");
  j["duration"] = 6000;
  Simulation sim = Simulation::from_json(j);
  sim.run_to_end();
  const auto& H = sim.history();
  const double tr_end = H.back().P.topLeftCorner<3, 3>().trace();
  const double tr_earlier = H[H.size() - 60].P.topLeftCorner<3, 3>().trace();  // 600 s before the end
  const double tr_start = H.front().P_prior.topLeftCorner<3, 3>().trace();
  CHECK(tr_end < 1e-5 * tr_start);
  CHECK(std::abs(tr_end / tr_earlier - 1.0) < 0.25);  // no longer shrinking quickly
}

TEST_CASE("linear KF on the CW lab converges to the discrete Riccati fixed point") {
  auto j = scenario_json("linear_lab_cw");
  j["duration"] = 40000;
  Simulation sim = Simulation::from_json(j);
  sim.run_to_end();
  const Mat P_sim = sim.history().back().P;  // a posteriori, just after an update

  // Independent Riccati iteration with the closed-form CW STM and Van Loan-free Qd from the propagator
  const double n = sim.scenario().truth.cw_mean_motion, T = 20.0;
  const Propagation p = propagate_variational(sim.estimator_model(), 0, Vec::Zero(6), Vec::Zero(3), T,
                                              {IntegratorMethod::RK4, 20.0}, sim.estimator().settings().Qc,
                                              Mat::Zero(3, 3));
  (void)n;
  Mat Hm = Mat::Zero(3, 6);
  Hm.leftCols(3).setIdentity();
  const Mat R = sim.sensors()[0]->R_assumed();
  Mat P = sim.scenario().estimator.P0;
  for (int k = 0; k < 20000; ++k) {
    const Mat S = Hm * P * Hm.transpose() + R;
    const Mat K = P * Hm.transpose() * S.inverse();
    P = (Mat::Identity(6, 6) - K * Hm) * P;
    P = p.Phi * P * p.Phi.transpose() + p.Qd;
  }
  // Convert the a-priori fixed point to a-posteriori
  const Mat S = Hm * P * Hm.transpose() + R;
  const Mat Ppost = P - P * Hm.transpose() * S.inverse() * Hm * P;
  CHECK(close(P_sim, Ppost, 1e-3, 1e-12));
}
