// Mathematical regression checks on the shipped mission scenarios. Each check compares
// against physics or statistics (not against a stored copy of our own output), so a bug
// cannot be "validated" by itself.

#include "test_helpers.hpp"

#include "osim/diagnostics/metrics.hpp"
#include "osim/diagnostics/statistics.hpp"
#include "osim/frames/frames.hpp"

using namespace osim;
using namespace osim::test;
using nlohmann::json;

TEST_CASE("First Fix: converges to GNSS-limited accuracy with consistent statistics") {
  Simulation sim = Simulation::from_json(scenario_json("first_fix"));
  sim.run_to_end();
  const json s = run_summary(sim);
  // With σ = 5 m fixes every 10 s, steady-state error is a few metres at most
  CHECK(s["accuracy"]["positionRmsTail"].get<double>() < 5.0);
  CHECK(s["accuracy"]["positionRmsTail"].get<double>() > 0.2);
  const double anis = s["calibration"]["anisPerDim"].get<double>();
  CHECK(anis > 0.8);
  CHECK(anis < 1.25);
  CHECK(s["calibration"]["verdict"] == "consistent");
}

TEST_CASE("Tracking Blackout: uncertainty grows along-track during the outage and covers the error") {
  Simulation sim = Simulation::from_json(scenario_json("tracking_blackout"));
  sim.run_to_end();
  double sig_before = 0, sig_end_outage = 0, sig_after = 0;
  int outside = 0, inside = 0;
  for (const auto& r : sim.history()) {
    if (std::abs(r.t - 1190) < 1e-9) sig_before = r.sigma_rtn[1];
    if (std::abs(r.t - 3590) < 1e-9) sig_end_outage = r.sigma_rtn[1];
    if (std::abs(r.t - 4200) < 1e-9) sig_after = r.sigma_rtn[1];
    if (r.t > 1200 && r.t < 3600) {
      // Along-track error inside the per-axis 99% band most of the time
      (std::abs(r.err_rtn[1]) <= std::sqrt(stats::chi2_quantile(0.99, 1)) * r.sigma_rtn[1] ? inside : outside)++;
    }
  }
  CHECK(sig_end_outage > 10.0 * sig_before);
  CHECK(sig_after < 0.2 * sig_end_outage);
  CHECK(inside > 9 * outside);
}

TEST_CASE("Unexpected Burn: innovations spike at the burn and NIS exceeds the 99.9% gate") {
  Simulation sim = Simulation::from_json(scenario_json("unexpected_burn"));
  sim.run_to_end();
  double nis_before = 0, nis_after = 0;
  int nb = 0, na = 0;
  for (const auto& m : sim.innovations()) {
    if (m.t < 1500) nis_before += m.nis, ++nb;
    if (m.t > 1500 && m.t < 1800) nis_after += m.nis, ++na;
  }
  nis_before /= nb;
  nis_after /= na;
  CHECK(nis_before < stats::chi2_quantile(0.99, 3));
  CHECK(nis_after > stats::chi2_quantile(0.999, 3));
  // Telling the filter about the burn removes the spike
  json j = scenario_json("unexpected_burn");
  j["controls"]["impulses"][0]["known"] = true;
  Simulation known = Simulation::from_json(j);
  known.run_to_end();
  CHECK(run_summary(known)["calibration"]["verdict"] == "consistent");
}

TEST_CASE("Planned Burn: the known maneuver keeps the filter consistent") {
  Simulation sim = Simulation::from_json(scenario_json("planned_burn"));
  sim.run_to_end();
  const json s = run_summary(sim);
  CHECK(s["calibration"]["verdict"] == "consistent");
  CHECK(s["accuracy"]["positionRmsTail"].get<double>() < 15.0);
}

TEST_CASE("Python reference case: the 12-state EKF tracks the reference scenario") {
  Simulation sim = Simulation::from_json(scenario_json("python_reference_rigid12"));
  sim.run_to_end();
  const json s = run_summary(sim);
  CHECK(sim.history().size() == 3001);
  // GNSS at 100 Hz with σ = 5 m: sub-metre position after 30 s
  CHECK(s["accuracy"]["positionFinal"].get<double>() < 2.0);
  CHECK(s["accuracy"]["attitudeRmsDeg"].get<double>() < 3.0);
  CHECK(s["calibration"]["aneesPerDim"].get<double>() < 3.0);
  // 50 N on 100 kg for 30 s adds ≈ 15 m/s along the (rotating) thrust axis
  const Vec v0 = sim.history().front().x_true.segment<3>(3), v1 = sim.history().back().x_true.segment<3>(3);
  const double mu = sim.scenario().truth.mu;
  const double dv_grav = (v1 - v0).norm();
  CHECK(dv_grav > 10.0);
  CHECK(frames::specific_energy(sim.history().back().x_true, mu) > frames::specific_energy(sim.history().front().x_true, mu));
}

TEST_CASE("Sensor Geometry (orbit): range+bearing beats range-only at the same station") {
  json j = scenario_json("sensor_geometry_orbit");
  j["sensors"][1]["enabled"] = false;  // Alpha range+bearing off
  j["sensors"][3]["enabled"] = false;  // Charlie range+bearing off
  Simulation ro = Simulation::from_json(j);
  ro.run_to_end();
  Simulation rb = Simulation::from_json(scenario_json("sensor_geometry_orbit"));
  rb.run_to_end();
  CHECK(run_summary(rb)["accuracy"]["positionRmsTail"].get<double>() <
        run_summary(ro)["accuracy"]["positionRmsTail"].get<double>());
}

TEST_CASE("every shipped scenario runs to completion with finite values for every estimator") {
  for (const std::string id : {"first_fix", "tracking_blackout", "noisy_receiver", "planned_burn", "unexpected_burn",
                               "sensor_geometry_orbit", "sensor_geometry_attitude", "filter_showdown", "kf_divergence",
                               "linear_lab_cw", "sandbox_elliptical"}) {
    for (const std::string type : {"ekf", "ukf", "pf", "kf"}) {
      json j = scenario_json(id);
      j["estimator"]["type"] = type;
      if (type == "pf") j["estimator"]["pf"]["particles"] = 100;
      j["duration"] = std::min(j["duration"].get<double>(), 900.0);
      Simulation sim = Simulation::from_json(j);
      sim.run_to_end();
      CAPTURE(id);
      CAPTURE(type);
      CHECK(sim.history().back().x_true.allFinite());
      if (id != "kf_divergence" || type != "kf") CHECK(sim.history().back().x_est.allFinite());
    }
  }
}
