// Estimators: noiseless convergence, exactness on a linear model, sigma-point properties,
// seeded reproducibility, Monte-Carlo NEES consistency, truth separation and comparisons.

#include "test_helpers.hpp"

#include "osim/diagnostics/metrics.hpp"
#include "osim/diagnostics/statistics.hpp"
#include "osim/estimators/estimator_registry.hpp"
#include "osim/estimators/ukf.hpp"

using namespace osim;
using namespace osim::test;
using nlohmann::json;

namespace {

json noiseless_first_fix(const std::string& type) {
  auto j = scenario_json("first_fix");
  j["estimator"]["type"] = type;
  j["sensors"][0]["trueSigma"] = 1e-3;
  j["sensors"][0]["assumedSigma"] = 1e-3;
  j["estimator"]["processNoisePsd"] = 0.0;
  j["duration"] = 600;
  if (type == "pf") j["estimator"]["pf"]["particles"] = 2000;
  return j;
}

}  // namespace

TEST_CASE("noiseless measurements: every nonlinear estimator converges to the truth") {
  for (const std::string type : {"ekf", "ukf"}) {
    Simulation sim = Simulation::from_json(noiseless_first_fix(type));
    sim.run_to_end();
    CAPTURE(type);
    CHECK(sim.history().back().err.head<3>().norm() < 0.01);   // 1 cm from a 2.7 km initial error
    CHECK(sim.history().back().err.segment<3>(3).norm() < 1e-4);
  }
  // The linearised KF keeps the 2.7 km linearisation error of its reference: it converges,
  // but only to the level allowed by the neglected second-order terms
  Simulation kf = Simulation::from_json(noiseless_first_fix("kf"));
  kf.run_to_end();
  CHECK(kf.history().back().err.head<3>().norm() < 1.0);
  // The particle filter is limited by its finite sample: check it is within a few metres
  Simulation pf = Simulation::from_json(noiseless_first_fix("pf"));
  pf.run_to_end();
  CHECK(pf.history().back().err.head<3>().norm() < 5.0);
}

TEST_CASE("on the linear CW model KF, EKF and UKF give the same answer") {
  auto j = scenario_json("linear_lab_cw");
  std::vector<std::vector<NodeRecord>> runs;
  for (const std::string type : {"kf", "ekf", "ukf"}) {
    j["estimator"]["type"] = type;
    Simulation sim = Simulation::from_json(j);
    sim.run_to_end();
    runs.push_back(sim.history());
  }
  for (size_t k = 0; k < runs[0].size(); k += 20)
    for (int r = 1; r < 3; ++r) {
      CHECK((runs[r][k].x_est - runs[0][k].x_est).norm() < 1e-6);
      CHECK(rel_err(runs[r][k].P, runs[0][k].P) < 1e-6);
    }
}

TEST_CASE("UKF weights and sigma points reproduce the mean and covariance") {
  auto model = build_model(ModelSpec{});
  EstimatorSettings s;
  s.ukf = {0.7, 2.0, 0.5};
  Ukf ukf(model, s);
  Vec x(6);
  x << 7e6, 1e5, -2e5, 10, 7500, -30;
  Mat A = Mat::Random(6, 6);
  const Mat P = A * A.transpose() * 100.0 + Mat::Identity(6, 6);
  ukf.initialize(0, x, P);
  CHECK(ukf.mean_weights().sum() == doctest::Approx(1.0));
  const Mat X = ukf.sigma_points();
  Vec m = Vec::Zero(6);
  for (int i = 0; i < X.cols(); ++i) m += ukf.mean_weights()[i] * X.col(i);
  CHECK((m - x).norm() < 1e-6);
  Mat C = Mat::Zero(6, 6);
  for (int i = 0; i < X.cols(); ++i) C += ukf.cov_weights()[i] * (X.col(i) - x) * (X.col(i) - x).transpose();
  const double a = 0.7;
  // Σ Wc (X − x)(X − x)ᵀ = P + (1 − α² + β) · 0 (the central point has zero deviation)
  CHECK(rel_err(C, P) < 1e-9);
  (void)a;
  s.ukf.alpha = 0.0;
  CHECK_THROWS_AS(Ukf(model, s), ConfigError);
}

TEST_CASE("particle filter is reproducible for a seed and changes with the seed") {
  auto j = scenario_json("first_fix");
  j["estimator"]["type"] = "pf";
  j["estimator"]["pf"]["particles"] = 200;
  j["duration"] = 400;
  auto run = [&](int seed) {
    j["estimator"]["seed"] = seed;
    Simulation sim = Simulation::from_json(j);
    sim.run_to_end();
    return sim.history_hash();
  };
  CHECK(run(3) == run(3));
  CHECK(run(3) != run(4));
}

TEST_CASE("seeded noisy runs: Monte-Carlo NEES is consistent for the EKF") {
  // Independent runs give independent NEES samples, so the χ² test is valid here
  auto j = scenario_json("first_fix");
  j["duration"] = 600;
  j["estimator"]["processNoisePsd"] = 0.0;
  const int runs = 40;
  double sum_nees = 0.0;
  for (int k = 0; k < runs; ++k) {
    j["seed"] = 500 + k;
    Simulation sim = Simulation::from_json(j);
    sim.run_to_end();
    sum_nees += sim.history().back().nees;
  }
  // 99.9% two-sided: noise realisations differ across platforms (libm), so keep false alarms rare
  const auto b = stats::average_chi2_bounds(6, runs, 0.999);
  const double anees = sum_nees / runs;
  MESSAGE("Monte-Carlo ANEES " << anees << " in [" << b.lower << ", " << b.upper << "]");
  CHECK(anees > b.lower);
  CHECK(anees < b.upper);
}

TEST_CASE("the estimate depends only on measurements and controls (no truth access)") {
  // Re-filter the logged measurements with a fresh EKF; it must reproduce the run exactly.
  auto j = scenario_json("planned_burn");
  j["duration"] = 2400;
  Simulation sim = Simulation::from_json(j);
  sim.run_to_end();
  const auto& sc = sim.scenario();
  auto ekf = EstimatorRegistry::instance().create("ekf", build_model(sc.estimator.model), sc.estimator.settings);
  ekf->initialize(0.0, sc.estimator.x0, sc.estimator.P0);
  size_t m = 0;
  const auto& inn = sim.innovations();
  for (const auto& r : sim.history()) {
    if (r.node > 0) {
      ekf->predict(r.t, sim.controls().for_estimator({r.u_actual, r.u_actual, r.u_measured, true}));
      for (const auto& e : sc.controls.impulses)
        if (std::abs(e.t - r.t) < 1e-9 && e.known)
          ekf->apply_impulse(sim.controls().commanded_impulse(e, ekf->mean()), e.assumed_sigma.cwiseAbs2().asDiagonal());
    }
    while (m < inn.size() && inn[m].node == r.node) {
      const Sensor& s = *sim.sensors()[inn[m].sensor];
      ekf->update(s, Measurement{inn[m].sensor, s.id(), inn[m].t, inn[m].sample, inn[m].z});
      ++m;
    }
    CHECK((ekf->mean() - r.x_est).norm() == 0.0);
  }
}

TEST_CASE("estimator comparison sanity on the showdown and divergence cases") {
  std::map<std::string, json> s;
  for (const std::string type : {"ekf", "ukf", "pf", "kf"}) {
    auto j = scenario_json("filter_showdown");
    j["estimator"]["type"] = type;
    if (type == "pf") j["estimator"]["pf"]["particles"] = 500;
    Simulation sim = Simulation::from_json(j);
    sim.run_to_end();
    s[type] = run_summary(sim);
  }
  for (const std::string type : {"ekf", "ukf", "pf"}) {
    CAPTURE(type);
    CHECK(s[type]["accuracy"]["positionRmsTail"].get<double>() < 100.0);
    CHECK(s[type]["calibration"]["aneesPerDim"].get<double>() < 5.0);
  }
  // The never-relinearised KF is worse than the EKF on the same data, and over-confident
  CHECK(s["kf"]["accuracy"]["positionRmsTail"].get<double>() > 5.0 * s["ekf"]["accuracy"]["positionRmsTail"].get<double>());
  CHECK(s["kf"]["calibration"]["verdict"] == "overconfident");
  // Cost ordering: the PF evaluates the dynamics far more often
  CHECK(s["pf"]["compute"]["dynamicsEvaluations"].get<double>() > 50.0 * s["ekf"]["compute"]["dynamicsEvaluations"].get<double>());

  auto j = scenario_json("kf_divergence");
  Simulation kf = Simulation::from_json(j);
  kf.run_to_end();
  j["estimator"]["type"] = "ekf";
  Simulation ekf = Simulation::from_json(j);
  ekf.run_to_end();
  CHECK(run_summary(kf)["accuracy"]["positionRmsTail"].get<double>() > 1e4);
  CHECK(run_summary(ekf)["accuracy"]["positionRmsTail"].get<double>() < 50.0);
}

TEST_CASE("frozen-linearization KF refuses nonlinear sensors with an explanation") {
  auto j = scenario_json("sensor_geometry_orbit");
  j["estimator"]["type"] = "kf";
  j["estimator"]["kf"] = {{"linearization", "frozen"}};
  j["duration"] = 900;
  Simulation sim = Simulation::from_json(j);
  sim.run_to_end();
  const auto support = sim.sensor_support();
  CHECK(support[0].empty());          // GNSS is linear
  CHECK_FALSE(support[1].empty());    // range/bearing is not
  for (size_t i = 1; i < sim.sensors().size(); ++i) CHECK(sim.measurements_used()[i] == 0);
}

TEST_CASE("registry lists all built-in estimators") {
  const auto list = EstimatorRegistry::instance().list();
  CHECK(list.size() >= 4);
  CHECK(EstimatorRegistry::instance().has("ekf"));
  CHECK(EstimatorRegistry::instance().has("ukf"));
  CHECK(EstimatorRegistry::instance().has("pf"));
  CHECK(EstimatorRegistry::instance().has("kf"));
  CHECK_FALSE(EstimatorRegistry::instance().has("magic"));
}
