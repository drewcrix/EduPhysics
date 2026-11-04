// Simulation orchestration: replay determinism, playback-speed independence, event order,
// asynchronous sensors, commanded/actual/measured controls and finite-thrust energy.

#include "test_helpers.hpp"

#include "osim/frames/frames.hpp"

#include <cmath>

using namespace osim;
using namespace osim::test;
using nlohmann::json;

TEST_CASE("replay with the action log reproduces an interactive run bit-for-bit") {
  const json j = scenario_json("first_fix");
  Simulation live = Simulation::from_json(j);
  while (!live.finished()) {
    const auto k = live.node_index();
    if (live.next_phase() == Simulation::Phase::Predict) {
      if (k == 40) live.apply_action({{"type", "setSensorEnabled"}, {"sensor", "gnss"}, {"enabled", false}});
      if (k == 90) live.apply_action({{"type", "setSensorEnabled"}, {"sensor", "gnss"}, {"enabled", true}});
      if (k == 120) live.apply_action({{"type", "setSensorAssumedNoise"}, {"sensor", "gnss"}, {"sigma", {20, 20, 20}}});
      if (k == 150) live.apply_action({{"type", "switchEstimator"}, {"estimator", "ukf"}});
      if (k == 160) live.apply_action({{"type", "setProcessNoise"}, {"psd", {1e-9, 1e-9, 1e-9}}});
      if (k == 170)
        live.apply_action({{"type", "addImpulse"}, {"impulse", {{"t", 2000}, {"dv", {0, 0.5, 0}}, {"known", false}}}});
      live.step_predict();
    } else {
      if (k == 200) live.apply_action({{"type", "switchEstimator"}, {"estimator", "pf"}, {"pf", {{"particles", 200}}}});
      live.step_update();
    }
  }
  const json log = live.action_log();
  CHECK(log.size() == 7);

  Simulation replay = Simulation::from_json(j);
  replay.schedule_actions(log);
  replay.run_to_end();
  CHECK(replay.history_hash() == live.history_hash());
  CHECK(replay.history().size() == live.history().size());
  CHECK(replay.action_log() == log);
  CHECK(replay.estimator().type() == "pf");
}

TEST_CASE("results do not depend on playback chunking or phase-by-phase stepping") {
  const json j = scenario_json("planned_burn");
  Simulation a = Simulation::from_json(j);
  a.run_to_end();
  Simulation b = Simulation::from_json(j);
  for (double t = 0; !b.finished(); t += 37.0) b.run_until(t);  // irregular "frame" chunks
  Simulation c = Simulation::from_json(j);
  while (!c.finished()) {
    c.step_predict();  // pause between prediction and update
    c.step_update();
  }
  CHECK(a.history_hash() == b.history_hash());
  CHECK(a.history_hash() == c.history_hash());
}

TEST_CASE("the truth trajectory never depends on sensor toggles or the estimator") {
  json j = scenario_json("sensor_geometry_orbit");
  j["duration"] = 1200;
  Simulation a = Simulation::from_json(j);
  a.run_to_end();
  j["sensors"][0]["enabled"] = true;
  j["sensors"][2]["enabled"] = false;
  j["estimator"]["type"] = "ukf";
  Simulation b = Simulation::from_json(j);
  b.run_to_end();
  REQUIRE(a.history().size() == b.history().size());
  for (size_t k = 0; k < a.history().size(); ++k) CHECK((a.history()[k].x_true - b.history()[k].x_true).norm() == 0.0);
}

TEST_CASE("impulse ordering: applied after propagation, before measurements at the same time") {
  json j = scenario_json("planned_burn");
  j["duration"] = 1600;
  Simulation sim = Simulation::from_json(j);
  sim.run_until(1500);
  const NodeRecord& r = sim.history().back();
  REQUIRE(r.t == doctest::Approx(1500.0));
  CHECK(r.impulse);
  const NodeRecord& before = sim.history()[sim.history().size() - 2];
  // Truth gains ≈ 2 m/s along-track at t = 1500 s
  const Mat3 C = frames::rtn_basis(r.x_true.head<3>(), r.x_true.segment<3>(3));
  const Vec3 dv_rtn = C * (r.x_true.segment<3>(3) - before.x_true.segment<3>(3));
  CHECK(dv_rtn[1] > 1.9);
  // The known burn is already in the prior used by the 1500 s update
  const Vec3 dv_est = C * (r.x_prior.segment<3>(3) - before.x_est.segment<3>(3));
  CHECK(dv_est[1] > 1.9);
  // The prior covariance includes the assumed execution uncertainty (0.03 m/s)
  CHECK(r.P_prior(4, 4) > before.P(4, 4) + 0.5 * 0.03 * 0.03);
}

TEST_CASE("asynchronous sensors are processed exactly at their own sample times") {
  json j = scenario_json("first_fix");
  j["duration"] = 200;
  j["sensors"][0]["period"] = 7;
  j["sensors"][0]["phase"] = 3;
  Simulation sim = Simulation::from_json(j);
  sim.run_to_end();
  for (const auto& m : sim.innovations()) CHECK(std::fmod(m.t - 3.0, 7.0) == doctest::Approx(0.0));
  CHECK(sim.innovations().size() == 29);  // 3, 10, ..., 199
  // The record grid (every 10 s) is still present
  int grid = 0;
  for (const auto& r : sim.history())
    if (std::abs(std::fmod(r.t, 10.0)) < 1e-9) ++grid;
  CHECK(grid == 21);
}

TEST_CASE("commanded, actual and measured controls are separate") {
  json j = scenario_json("sensor_geometry_attitude");
  j["controls"]["trueScaleError"] = 0.1;
  j["controls"]["telemetrySigmaTrue"] = {0.5, 0, 0, 0};
  Simulation sim = Simulation::from_json(j);
  const ControlSample c = sim.controls().sample(250.0, sim.true_state(), 25);
  CHECK(c.active);
  CHECK(c.actual[0] == doctest::Approx(1.1 * c.commanded[0]));
  CHECK(c.measured[0] != c.actual[0]);
  CHECK(std::abs(c.measured[0] - c.actual[0]) < 5 * 0.5);
  j["controls"]["estimatorKnowsThrust"] = false;
  Simulation blind = Simulation::from_json(j);
  CHECK(blind.controls().for_estimator(c).norm() == 0.0);
}

TEST_CASE("finite thrust changes orbital energy by the work done") {
  json j = scenario_json("first_fix");
  j["duration"] = 1200;
  j["dt"] = 1;
  j["truth"]["integrator"]["maxStep"] = 1;
  j["sensors"][0]["period"] = 60;
  j["truth"]["spacecraft"] = {{"mass", 100.0}};
  j["controls"] = {{"segments", {{{"start", 100}, {"end", 700}, {"thrustN", 1.0}, {"frame", "RTN"}, {"direction", {0, 1, 0}}}}}};
  Simulation sim = Simulation::from_json(j);
  sim.run_to_end();
  const double mu = sim.scenario().truth.mu;
  double work = 0.0;  // trapezoidal ∫ a·v dt from the recorded actual control
  const auto& H = sim.history();
  for (size_t k = 1; k < H.size(); ++k) {
    const double dt = H[k].t - H[k - 1].t;
    const Vec3 a = H[k].u_actual;  // control over [t_{k-1}, t_k)
    work += 0.5 * dt * (a.dot(H[k - 1].x_true.segment<3>(3)) + a.dot(H[k].x_true.segment<3>(3)));
  }
  const double de = frames::specific_energy(H.back().x_true, mu) - frames::specific_energy(H.front().x_true, mu);
  CHECK(work > 0.0);
  CHECK(de == doctest::Approx(work).epsilon(1e-4));
}

TEST_CASE("invalid scenarios fail with readable messages") {
  json j = scenario_json("first_fix");
  j["estimator"]["initialCovariance"] = {{1, 2, 0, 0, 0, 0}, {0, 1, 0, 0, 0, 0}, {0, 0, 1, 0, 0, 0},
                                          {0, 0, 0, 1, 0, 0}, {0, 0, 0, 0, 1, 0}, {0, 0, 0, 0, 0, 1}};
  CHECK_THROWS_WITH_AS(Simulation::from_json(j), doctest::Contains("not symmetric"), ConfigError);
  j = scenario_json("first_fix");
  j["truth"]["initialState"]["altitudeM"] = -7000e3;
  CHECK_THROWS_AS(Simulation::from_json(j), ConfigError);
  j = scenario_json("first_fix");
  j["estimator"]["type"] = "magic";
  CHECK_THROWS_WITH_AS(Simulation::from_json(j), doctest::Contains("Unknown estimator"), ConfigError);
  Simulation sim = Simulation::from_json(scenario_json("first_fix"));
  CHECK_THROWS_AS(sim.apply_action({{"type", "setSensorEnabled"}, {"sensor", "nope"}, {"enabled", true}}), ConfigError);
  CHECK_THROWS_AS(sim.apply_action({{"type", "setProcessNoise"}, {"psd", {-1, 0, 0}}}), ConfigError);
  CHECK(sim.action_log().empty());  // rejected actions are not logged
}

TEST_CASE("sensor cadence can change mid-run without reusing noise draws") {
  json j = scenario_json("first_fix");
  j["duration"] = 600;
  Simulation sim = Simulation::from_json(j);
  sim.run_until(100);
  sim.apply_action({{"type", "setSensorPeriod"}, {"sensor", "gnss"}, {"period", 30}});
  sim.run_to_end();
  std::vector<double> after;
  for (const auto& m : sim.innovations())
    if (m.t > 100.0) after.push_back(m.t);
  REQUIRE_FALSE(after.empty());
  for (size_t i = 0; i < after.size(); ++i) CHECK(after[i] == doctest::Approx(130.0 + 30.0 * i));
  // Replay reproduces the cadence change
  Simulation replay = Simulation::from_json(j);
  replay.schedule_actions(sim.action_log());
  replay.run_to_end();
  CHECK(replay.history_hash() == sim.history_hash());
  CHECK_THROWS_AS(sim.apply_action({{"type", "setSensorPeriod"}, {"sensor", "gnss"}, {"period", 0}}), ConfigError);
}
