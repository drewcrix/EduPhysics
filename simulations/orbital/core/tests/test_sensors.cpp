// Sensors: Jacobians, ground-station geometry, noise statistics, timing and dropouts.

#include "test_helpers.hpp"

#include "osim/dynamics/orbital_dynamics.hpp"
#include "osim/estimators/covariance_utils.hpp"
#include "osim/frames/attitude.hpp"
#include "osim/frames/frames.hpp"
#include "osim/sensors/basic_sensors.hpp"
#include "osim/sensors/ground_station.hpp"
#include "osim/sensors/sensor_registry.hpp"

#include <cmath>

using namespace osim;
using namespace osim::test;
using nlohmann::json;

namespace {

SensorConfig cfg(const std::string& id, int dim, double sigma, double period = 10.0) {
  SensorConfig c;
  c.id = id;
  c.period = period;
  c.R_true = c.R_assumed = sigma * sigma * Mat::Identity(dim, dim);
  return c;
}

GroundSite site() { return {"Test", 0.5, 0.8, 200.0, 10.0 * constants::DEG}; }

}  // namespace

TEST_CASE("ground-station range/azimuth/elevation Jacobian matches finite differences") {
  SensorConfig c = cfg("gs", 3, 1.0);
  GroundStationSensor gs(c, site(), GroundStationSensor::Mode::RangeBearing, 0.3);
  SensorConfig c1 = cfg("gr", 1, 1.0);
  GroundStationSensor gr(c1, site(), GroundStationSensor::Mode::RangeOnly, 0.3);
  const double t = 123.0;
  // Spacecraft 800 km above a point near the station
  const Vec3 above = frames::rot_z(frames::greenwich_angle(t, 0.3)) *
                     frames::geodetic_to_ecef(0.52, 0.83, 800e3);
  Vec x = Vec::Zero(6);
  x.head<3>() = above;
  x.tail<3>() << 7000, -1000, 500;
  REQUIRE(gs.visible(t, x));
  Vec h = Vec::Constant(6, 1.0);
  const Mat Hfd = fd_jacobian([&](const Vec& y) { return gs.h(t, y); }, x, h);
  CHECK(close(gs.H(t, x), Hfd, 1e-6, 1e-12));
  CHECK(close(gr.H(t, x), fd_jacobian([&](const Vec& y) { return gr.h(t, y); }, x, h), 1e-6, 1e-12));
  CHECK(gs.H(t, x).rightCols(3).norm() == 0.0);  // no velocity dependence
}

TEST_CASE("ground-station geometry: overhead pass and horizon") {
  SensorConfig c = cfg("gs", 3, 1.0);
  const GroundSite s{"Zenith", 0.2, -1.0, 0.0, 10.0 * constants::DEG};
  GroundStationSensor gs(c, s, GroundStationSensor::Mode::RangeBearing, 0.0);
  const double t = 0.0;
  Vec x = Vec::Zero(6);
  x.head<3>() = frames::geodetic_to_ecef(s.lat, s.lon, 500e3);
  const Vec z = gs.h(t, x);
  CHECK(z[0] == doctest::Approx(500e3).epsilon(1e-9));
  CHECK(z[2] == doctest::Approx(constants::PI / 2).epsilon(1e-9));
  CHECK_FALSE(gs.visible(t, x));  // azimuth undefined exactly overhead: rejected
  x.head<3>() = -x.head<3>();     // other side of the Earth
  CHECK_FALSE(gs.visible(t, x));
  // Due north, low elevation: azimuth ≈ 0
  x.head<3>() = frames::geodetic_to_ecef(s.lat + 0.08, s.lon, 500e3);
  CHECK(gs.visible(t, x));
  CHECK(std::abs(gs.h(t, x)[1]) < 1e-9);
}

TEST_CASE("simulated noise has the configured covariance") {
  SensorConfig c = cfg("g", 3, 1.0);
  c.R_true << 25, 3, 0, 3, 16, -2, 0, -2, 9;
  GnssPositionSensor s(c);
  Vec x = Vec::Zero(6);
  x.head<3>() << 7e6, 1e5, 2e5;
  const int N = 40000;
  Vec mean = Vec::Zero(3);
  Mat C = Mat::Zero(3, 3);
  for (int k = 0; k < N; ++k) {
    Rng rng(99, "sensor:g", static_cast<std::uint64_t>(k));
    const Vec e = s.simulate(0, x, rng) - x.head<3>();
    mean += e / N;
    C += e * e.transpose() / N;
  }
  CHECK(mean.norm() < 0.1);
  CHECK(close(C, c.R_true, 0.05, 0.3));
}

TEST_CASE("star tracker: body-frame error maps to Euler covariance W R Wᵀ") {
  SensorConfig c = cfg("st", 3, 1e-3);
  StarTrackerSensor s(c);
  Vec x = Vec::Zero(12);
  x.head<3>() << 7e6, 0, 0;
  x.segment<3>(6) << 0.2, 0.6, -0.4;
  const int N = 20000;
  Mat C = Mat::Zero(3, 3);
  for (int k = 0; k < N; ++k) {
    Rng rng(5, "sensor:st", static_cast<std::uint64_t>(k));
    const Vec e = s.residual(s.simulate(0, x, rng), x.segment<3>(6));
    C += e * e.transpose() / N;
  }
  CHECK(close(C, s.filter_covariance(x), 0.06, 1e-8));
}

TEST_CASE("sample schedule, phase and outages") {
  SensorConfig c = cfg("g", 3, 5.0, 7.0);
  c.phase = 3.0;
  c.outages = {{20.0, 40.0}};
  GnssPositionSensor s(c);
  CHECK(s.sample_time(s.next_sample_after(0.0)) == doctest::Approx(3.0));
  CHECK(s.sample_time(s.next_sample_after(3.0)) == doctest::Approx(10.0));
  CHECK(s.sample_time(s.next_sample_after(9.999)) == doctest::Approx(10.0));
  CHECK(s.in_outage(20.0));
  CHECK(s.in_outage(40.0));
  CHECK_FALSE(s.in_outage(40.0001));
}

TEST_CASE("sensors needing attitude are rejected on the orbit-only model with an explanation") {
  OrbitalDynamics m({std::make_shared<PointMassGravity>(constants::MU_EARTH)});
  GyroSensor g(cfg("gy", 3, 1e-4), Vec3::Zero());
  StarTrackerSensor st(cfg("st", 3, 1e-3));
  CHECK_FALSE(g.unsupported_reason(m).empty());
  CHECK_FALSE(st.unsupported_reason(m).empty());
  GnssPositionSensor gn(cfg("gn", 3, 5));
  CHECK(gn.unsupported_reason(m).empty());
}

TEST_CASE("registry builds sensors from JSON and validates noise") {
  SensorBuildContext ctx;
  json j = {{"id", "a"}, {"type", "gnss_position"}, {"trueSigma", 5}};
  auto s = SensorRegistry::instance().create(j, ctx);
  CHECK(s->dim() == 3);
  CHECK(s->R_assumed()(0, 0) == doctest::Approx(25.0));
  json bad = {{"id", "b"}, {"type", "gnss_position"}, {"trueCovariance", {{1, 2, 0}, {0, 1, 0}, {0, 0, 1}}}};
  CHECK_THROWS_WITH_AS(SensorRegistry::instance().create(bad, ctx), doctest::Contains("not symmetric"), ConfigError);
  json neg = {{"id", "c"}, {"type", "gnss_position"}, {"trueCovariance", {{1, 2, 0}, {2, 1, 0}, {0, 0, 1}}}};
  CHECK_THROWS_WITH_AS(SensorRegistry::instance().create(neg, ctx), doctest::Contains("positive definite"), ConfigError);
  json unk = {{"id", "d"}, {"type", "lidar"}, {"trueSigma", 1}};
  CHECK_THROWS_AS(SensorRegistry::instance().create(unk, ctx), ConfigError);
}

TEST_CASE("simulation records dropouts, outages and disabled sensors at exactly the right nodes") {
  json j = scenario_json("tracking_blackout");
  j["duration"] = 1500;
  j["sensors"][0]["outages"] = json::array({json::array({600, 800})});
  Simulation sim = Simulation::from_json(j);
  sim.run_to_end();
  int outage = 0, used = 0;
  for (const auto& r : sim.history()) {
    if (r.sensor_status.empty()) continue;
    if (r.sensor_status[0] == SensorStatus::Outage) {
      ++outage;
      CHECK(r.t >= 600.0);
      CHECK(r.t <= 800.0);
    }
    if (r.sensor_status[0] == SensorStatus::Used) ++used;
  }
  CHECK(outage == 21);  // samples at 600, 610, ..., 800
  CHECK(used == 151 - 21);
  CHECK(sim.measurements_used()[0] == used);
}

TEST_CASE("unsupported sensor/model combinations are reported, not fabricated") {
  json j = scenario_json("first_fix");
  j["sensors"].push_back({{"id", "gyro"}, {"type", "gyro"}, {"period", 10}, {"trueSigma", 1e-4}});
  Simulation sim = Simulation::from_json(j);
  sim.run_until(100);
  CHECK(sim.history().back().sensor_status[1] == SensorStatus::Unsupported);
  CHECK(sim.measurements_used()[1] == 0);
  bool found = false;
  for (const auto& m : sim.messages()) found |= m.find("no attitude states") != std::string::npos;
  CHECK(found);
}
