#include "osim/estimators/estimator_registry.hpp"

#include "osim/estimators/linear_kf.hpp"
#include "osim/estimators/particle_filter.hpp"
#include "osim/estimators/ukf.hpp"

namespace osim {

EstimatorRegistry& EstimatorRegistry::instance() {
  static EstimatorRegistry r;
  return r;
}

void EstimatorRegistry::add(EstimatorInfo info, Factory make) {
  const std::string key = info.type;
  entries_[key] = {std::move(info), std::move(make)};
}

EstimatorPtr EstimatorRegistry::create(const std::string& type, DynamicsModelPtr model,
                                       const EstimatorSettings& s) const {
  auto it = entries_.find(type);
  if (it == entries_.end()) throw ConfigError("Unknown estimator type '" + type + "'.");
  return it->second.second(std::move(model), s);
}

std::vector<EstimatorInfo> EstimatorRegistry::list() const {
  std::vector<EstimatorInfo> out;
  for (const auto& [k, v] : entries_) out.push_back(v.first);
  return out;
}

EstimatorRegistry::EstimatorRegistry() {
  add({"ekf", "Extended Kalman Filter",
       "Linearises dynamics and sensors about the current estimate at every step.", false},
      [](DynamicsModelPtr m, const EstimatorSettings& s) { return std::make_unique<Ekf>(std::move(m), s); });
  add({"ukf", "Unscented Kalman Filter",
       "Pushes 2n+1 sigma points through the nonlinear models; no Jacobians of f or h needed.", false},
      [](DynamicsModelPtr m, const EstimatorSettings& s) { return std::make_unique<Ukf>(std::move(m), s); });
  add({"pf", "Particle Filter",
       "Represents uncertainty by weighted samples; handles non-Gaussian beliefs at high cost.", true},
      [](DynamicsModelPtr m, const EstimatorSettings& s) {
        return std::make_unique<ParticleFilter>(std::move(m), s);
      });
  add({"kf", "Linear Kalman Filter",
       "Standard KF on a fixed linearisation (reference trajectory or frozen); exact only for linear models.",
       false},
      [](DynamicsModelPtr m, const EstimatorSettings& s) { return std::make_unique<LinearKf>(std::move(m), s); });
}

}  // namespace osim
