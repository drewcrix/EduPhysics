#include "osim/sensors/sensor_registry.hpp"

#include "osim/constants.hpp"
#include "osim/sensors/basic_sensors.hpp"
#include "osim/sensors/ground_station.hpp"
#include "osim/simulation/json_util.hpp"

namespace osim {

using json_util::json;

SensorConfig parse_common_sensor_config(const json& j, int dim) {
  SensorConfig c;
  c.id = j.at("id").get<std::string>();
  c.name = json_util::value_or<std::string>(j, "name", c.id);
  c.enabled = json_util::value_or(j, "enabled", true);
  c.period = json_util::value_or(j, "period", 10.0);
  c.phase = json_util::value_or(j, "phase", 0.0);
  c.cost = json_util::value_or(j, "cost", 1.0);
  if (j.contains("outages"))
    for (const auto& o : j.at("outages")) c.outages.push_back({o.at(0).get<double>(), o.at(1).get<double>()});
  const std::string who = "sensor '" + c.id + "'";
  if (!json_util::read_covariance(j, "true", dim, "true noise of " + who, c.R_true))
    throw ConfigError("Sensor '" + c.id + "' needs \"trueSigma\" or \"trueCovariance\".");
  if (!json_util::read_covariance(j, "assumed", dim, "assumed noise of " + who, c.R_assumed))
    c.R_assumed = c.R_true;  // by default the filter knows the true noise level
  return c;
}

SensorRegistry& SensorRegistry::instance() {
  static SensorRegistry r;
  return r;
}

void SensorRegistry::add(const std::string& type, Factory make, std::string description) {
  entries_[type] = {std::move(make), std::move(description)};
}

SensorPtr SensorRegistry::create(const json& j, const SensorBuildContext& ctx) const {
  const std::string type = j.at("type").get<std::string>();
  auto it = entries_.find(type);
  if (it == entries_.end()) throw ConfigError("Unknown sensor type '" + type + "'.");
  return it->second.make(j, ctx);
}

namespace {

SensorPtr make_ground(const json& j, const SensorBuildContext& ctx, GroundStationSensor::Mode mode) {
  const int dim = mode == GroundStationSensor::Mode::RangeOnly ? 1 : 3;
  auto cfg = parse_common_sensor_config(j, dim);
  const auto& s = j.at("station");
  GroundSite site;
  site.name = json_util::value_or<std::string>(s, "name", cfg.id);
  site.lat = s.at("latDeg").get<double>() * constants::DEG;
  site.lon = s.at("lonDeg").get<double>() * constants::DEG;
  site.alt = json_util::value_or(s, "altM", 0.0);
  site.min_elevation = json_util::value_or(j, "minElevationDeg", 10.0) * constants::DEG;
  return std::make_shared<GroundStationSensor>(std::move(cfg), site, mode, ctx.theta_g0);
}

}  // namespace

SensorRegistry::SensorRegistry() {
  add("gnss_position",
      [](const json& j, const SensorBuildContext&) {
        return std::make_shared<GnssPositionSensor>(parse_common_sensor_config(j, 3));
      },
      "GNSS-derived position fix (receiver navigation solution, not raw pseudorange)");
  add("gnss_pv",
      [](const json& j, const SensorBuildContext&) {
        return std::make_shared<GnssPositionVelocitySensor>(parse_common_sensor_config(j, 6));
      },
      "GNSS position + velocity navigation solution");
  add("gyro",
      [](const json& j, const SensorBuildContext&) {
        Vec3 bias = j.contains("trueBias") ? Vec3(json_util::get_vec(j.at("trueBias"), 3, "gyro bias")) : Vec3::Zero();
        return std::make_shared<GyroSensor>(parse_common_sensor_config(j, 3), bias);
      },
      "Rate gyroscope (body angular rate)");
  add("star_tracker",
      [](const json& j, const SensorBuildContext&) {
        return std::make_shared<StarTrackerSensor>(parse_common_sensor_config(j, 3));
      },
      "Star tracker (attitude, reported in the tutorial Euler representation)");
  add("ground_station",
      [](const json& j, const SensorBuildContext& ctx) {
        return make_ground(j, ctx, GroundStationSensor::Mode::RangeBearing);
      },
      "Ground-station range, azimuth and elevation");
  add("ground_range",
      [](const json& j, const SensorBuildContext& ctx) {
        return make_ground(j, ctx, GroundStationSensor::Mode::RangeOnly);
      },
      "Ground-station range only (teaching variant)");
}

}  // namespace osim
