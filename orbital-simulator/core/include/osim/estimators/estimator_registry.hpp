#pragma once
/**
 * Registry of estimator types, keyed by the "type" string used in scenarios and the UI.
 *
 * Adding an estimator = implement the Estimator interface and add one `add(...)` line in
 * EstimatorRegistry's constructor (src/estimators/estimator_registry.cpp). Nothing in the
 * simulation, bindings or frontend needs to change: the UI lists whatever is registered.
 */

#include "osim/estimators/estimator.hpp"

#include <functional>
#include <map>

namespace osim {

struct EstimatorInfo {
  std::string type;
  std::string display_name;
  std::string summary;     // one-line description shown in the estimator picker
  bool stochastic = false; // results depend on the estimator's own random seed
};

class EstimatorRegistry {
 public:
  using Factory = std::function<EstimatorPtr(DynamicsModelPtr, const EstimatorSettings&)>;

  static EstimatorRegistry& instance();
  void add(EstimatorInfo info, Factory make);
  EstimatorPtr create(const std::string& type, DynamicsModelPtr model, const EstimatorSettings& s) const;
  std::vector<EstimatorInfo> list() const;
  bool has(const std::string& type) const { return entries_.count(type) > 0; }

 private:
  EstimatorRegistry();
  std::map<std::string, std::pair<EstimatorInfo, Factory>> entries_;
};

}  // namespace osim
