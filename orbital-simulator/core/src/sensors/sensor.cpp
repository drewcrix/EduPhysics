#include "osim/sensors/sensor.hpp"

#include "osim/estimators/covariance_utils.hpp"

#include <cmath>

namespace osim {

Sensor::Sensor(SensorConfig cfg) : cfg_(std::move(cfg)) {
  if (cfg_.id.empty()) throw ConfigError("Every sensor needs an id.");
  if (!(cfg_.period > 0.0)) throw ConfigError("Sensor '" + cfg_.id + "' must have a positive period.");
  if (cfg_.phase < 0.0) throw ConfigError("Sensor '" + cfg_.id + "' must have a non-negative phase.");
  for (const auto& o : cfg_.outages)
    if (!(o.end >= o.start)) throw ConfigError("Sensor '" + cfg_.id + "' has an outage that ends before it starts.");
}

std::string MeasurementModel::unsupported_reason(const DynamicsModel&) const { return {}; }

bool MeasurementModel::visible(double, const Vec&) const { return true; }

Vec MeasurementModel::residual(const Vec& z, const Vec& zhat) const {
  Vec r = z - zhat;
  const auto lab = labels();
  for (int i = 0; i < r.size(); ++i)
    if (lab[i].is_angle()) r[i] = wrap_angle(r[i]);
  return r;
}

Vec Sensor::simulate(double t, const Vec& x_true, Rng& rng) const {
  bool jitter = false;
  const Mat L = cov::safe_cholesky(cfg_.R_true, &jitter);
  Vec z = h(t, x_true) + rng.gaussian(L);
  const auto lab = labels();
  for (int i = 0; i < z.size(); ++i)
    if (lab[i].is_angle()) z[i] = wrap_angle(z[i]);
  return z;
}

Mat Sensor::filter_covariance(const Vec&) const { return cfg_.R_assumed; }

void Sensor::set_period(double period, double t) {
  if (!(period > 0.0)) throw ConfigError("Sensor '" + cfg_.id + "' must have a positive period.");
  cfg_.period = period;
  // Re-anchor the schedule so samples continue at t + k·period (k ≥ 1)
  cfg_.phase = std::fmod(t, period);
}

bool Sensor::in_outage(double t) const {
  for (const auto& o : cfg_.outages)
    if (o.contains(t)) return true;
  return false;
}

long long Sensor::next_sample_after(double t) const {
  // Smallest k >= 0 with phase + k period > t + 1e-9
  const double kf = std::floor((t + 1e-9 - cfg_.phase) / cfg_.period) + 1.0;
  long long k = std::max(0LL, static_cast<long long>(kf));
  while (sample_time(k) <= t + 1e-9) ++k;
  while (k > 0 && sample_time(k - 1) > t + 1e-9) --k;
  return k;
}

void Sensor::check_noise_dims() const {
  std::vector<std::string> units;
  for (const auto& l : labels()) units.push_back(l.unit + "²");
  auto c = cov::validate(cfg_.R_true, dim(), "True noise covariance of sensor '" + cfg_.id + "'", true, units);
  if (!c.ok) throw ConfigError(c.message);
  c = cov::validate(cfg_.R_assumed, dim(), "Assumed noise covariance R of sensor '" + cfg_.id + "'", true, units);
  if (!c.ok) throw ConfigError(c.message);
}

void Sensor::set_R_true(const Mat& R) {
  const Mat old = cfg_.R_true;
  cfg_.R_true = R;
  try {
    check_noise_dims();
  } catch (...) {
    cfg_.R_true = old;
    throw;
  }
}

void Sensor::set_R_assumed(const Mat& R) {
  const Mat old = cfg_.R_assumed;
  cfg_.R_assumed = R;
  try {
    check_noise_dims();
  } catch (...) {
    cfg_.R_assumed = old;
    throw;
  }
}

}  // namespace osim
