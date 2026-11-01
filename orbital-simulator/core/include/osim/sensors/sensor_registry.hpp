#pragma once
/**
 * Registry of sensor types, keyed by the "type" string used in scenario files.
 *
 * Adding a sensor = write a Sensor subclass and add one `add(...)` line in
 * register_builtin_sensors() (src/sensors/sensor_registry.cpp).
 */

#include "osim/sensors/sensor.hpp"

#include <nlohmann/json.hpp>

#include <functional>
#include <map>

namespace osim {

struct SensorBuildContext {
  const DynamicsModel* model = nullptr;
  double theta_g0 = 0.0;  // Greenwich angle at epoch (rad)
};

/// Parse the fields shared by all sensors (id, timing, outages, noise of dimension dim).
SensorConfig parse_common_sensor_config(const nlohmann::json& j, int dim);

class SensorRegistry {
 public:
  using Factory = std::function<SensorPtr(const nlohmann::json&, const SensorBuildContext&)>;
  struct Entry {
    Factory make;
    std::string description;
  };

  static SensorRegistry& instance();
  void add(const std::string& type, Factory make, std::string description);
  SensorPtr create(const nlohmann::json& j, const SensorBuildContext& ctx) const;
  const std::map<std::string, Entry>& entries() const { return entries_; }

 private:
  SensorRegistry();
  std::map<std::string, Entry> entries_;
};

}  // namespace osim
