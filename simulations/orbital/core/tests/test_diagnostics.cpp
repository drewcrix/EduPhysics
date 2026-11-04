// Diagnostics: χ² quantiles against tables, joint vs marginal confidence, ellipsoids and
// the local observability analysis (rank, null space, informative maneuvers).

#include "test_helpers.hpp"

#include "osim/diagnostics/ellipsoid.hpp"
#include "osim/diagnostics/metrics.hpp"
#include "osim/diagnostics/observability.hpp"
#include "osim/diagnostics/statistics.hpp"

using namespace osim;
using namespace osim::test;
using nlohmann::json;

TEST_CASE("chi-square quantiles match published tables") {
  CHECK(stats::chi2_quantile(0.99, 1) == doctest::Approx(6.634897).epsilon(1e-6));  // scipy chi2.isf(0.01, 1)
  CHECK(stats::chi2_quantile(0.99, 2) == doctest::Approx(9.210340).epsilon(1e-6));
  CHECK(stats::chi2_quantile(0.99, 3) == doctest::Approx(11.344867).epsilon(1e-6));
  CHECK(stats::chi2_quantile(0.95, 6) == doctest::Approx(12.591587).epsilon(1e-6));
  CHECK(stats::chi2_quantile(0.975, 10) == doctest::Approx(20.483177).epsilon(1e-6));
  CHECK(stats::chi2_quantile(0.025, 1200) == doctest::Approx(1105.0).epsilon(2e-3));
  for (double k : {1.0, 3.0, 12.0, 400.0})
    for (double p : {0.01, 0.5, 0.95})
      CHECK(stats::chi2_cdf(stats::chi2_quantile(p, k), k) == doctest::Approx(p).epsilon(1e-9));
}

TEST_CASE("joint 99% ellipsoid is larger than the per-axis 99% band") {
  // Using the 1-D 99% scale for a 3-D ellipsoid would only contain ~91.6% probability
  CHECK(mass_inside(stats::chi2_quantile(0.99, 1), 3) == doctest::Approx(0.9156).epsilon(1e-3));
  Mat P(3, 3);
  P << 400, 120, 0, 120, 100, 0, 0, 0, 25;
  const Ellipsoid e = confidence_region(Vec3(1, 2, 3), P, 0.99);
  CHECK(e.k2 == doctest::Approx(11.344867).epsilon(1e-6));
  CHECK(e.semi_axes[0] >= e.semi_axes[1]);
  CHECK(e.semi_axes[1] >= e.semi_axes[2]);
  CHECK((e.axes.transpose() * e.axes - Mat::Identity(3, 3)).norm() < 1e-12);
  CHECK(e.axes.determinant() == doctest::Approx(1.0));
  // Reconstructs P
  const Mat Pr = e.axes * (e.semi_axes.cwiseAbs2() / e.k2).asDiagonal() * e.axes.transpose();
  CHECK(rel_err(Pr, P) < 1e-12);
  CHECK(marginal_bound(25.0, 0.99) == doctest::Approx(std::sqrt(6.634897) * 5.0).epsilon(1e-6));
}

TEST_CASE("observability: GNSS over a window observes the whole orbit; one epoch does not") {
  Simulation sim = Simulation::from_json(scenario_json("first_fix"));
  const auto one = local_observability(sim, 0.0);
  CHECK(one.rank == 3);  // a single position fix says nothing about velocity
  CHECK(one.unobservable[3]);
  const auto win = local_observability(sim, 60.0);
  CHECK(win.rank == 6);  // consecutive positions reveal velocity
  CHECK(std::isfinite(win.best_sigma[3]));
}

TEST_CASE("observability: attitude is unobservable from GNSS alone, partly revealed by thrust") {
  json j = scenario_json("sensor_geometry_attitude");
  // Zero body rates in the estimate: then roll about the thrust axis cannot couple into
  // pitch/yaw through the Euler kinematics (θ̇ = cosφ q − sinφ r), so it stays invisible.
  j["truth"]["initialState"]["omegaRadS"] = {0, 0, 0};
  j["controls"]["segments"][0]["torqueAmplitudeNm"] = {0, 0, 0};
  for (int i = 9; i < 12; ++i) j["estimator"]["initialError"][i] = 0.0;
  j["sensors"][1]["enabled"] = false;  // no gyro
  j["sensors"][2]["enabled"] = false;  // no star tracker
  Simulation coast = Simulation::from_json(j);
  const auto r0 = local_observability(coast, 100.0);  // window before the thrust arc
  CHECK(r0.rank == 6);
  for (int i = 6; i < 12; ++i) CHECK(r0.unobservable[i]);
  coast.run_until(200);
  const auto r1 = local_observability(coast, 100.0);  // window covering the thrust arc
  CHECK(r1.rank > 6);
  CHECK(r1.unobservable[6]);  // roll about the thrust axis never shows up in position

  j["sensors"][1]["enabled"] = true;
  j["sensors"][2]["enabled"] = true;
  Simulation full = Simulation::from_json(j);
  CHECK(local_observability(full, 20.0).rank == 12);
}

TEST_CASE("observability: range-only from one station has rank 1 per epoch") {
  json j = scenario_json("sensor_geometry_orbit");
  Simulation sim = Simulation::from_json(j);
  sim.run_until(1100);  // inside the Bravo (range-only) pass
  std::vector<const Sensor*> bravo{sim.sensors()[2].get()};
  REQUIRE(bravo[0]->visible(sim.time(), sim.true_state()));
  const auto r = local_observability(sim.estimator_model(), sim.estimator().settings().integrator, sim.time(),
                                     sim.estimator().mean(), 0.0, bravo, nullptr);
  CHECK(r.rank == 1);
  const auto rw = local_observability(sim.estimator_model(), sim.estimator().settings().integrator, sim.time(),
                                      sim.estimator().mean(), 300.0, bravo, nullptr);
  CHECK(rw.rank > 1);
}

TEST_CASE("observability with no measurements reports rank 0 and explains dead reckoning") {
  json j = scenario_json("first_fix");
  j["sensors"][0]["enabled"] = false;
  Simulation sim = Simulation::from_json(j);
  const auto r = local_observability(sim, 100.0);
  CHECK(r.rank == 0);
  CHECK_FALSE(r.notes.empty());
}

TEST_CASE("run summary separates accuracy, calibration and resource cost") {
  json j = scenario_json("noisy_receiver");
  Simulation over = Simulation::from_json(j);
  over.run_to_end();
  const json so = run_summary(over);
  CHECK(so["calibration"]["verdict"] == "overconfident");  // assumes 5 m, truth is 30 m
  j["sensors"][0]["assumedSigma"] = {30, 30, 30};
  Simulation matched = Simulation::from_json(j);
  matched.run_to_end();
  const json sm = run_summary(matched);
  CHECK(sm["calibration"]["verdict"] == "consistent");
  CHECK(sm["resources"]["totalCost"].get<double>() == doctest::Approx(301.0));
  CHECK(sm["accuracy"]["positionRms"].get<double>() > 0.0);
}
