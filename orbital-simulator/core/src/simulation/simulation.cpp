#include "osim/simulation/simulation.hpp"

#include "osim/estimators/covariance_utils.hpp"
#include "osim/estimators/estimator_registry.hpp"
#include "osim/frames/frames.hpp"
#include "osim/rng.hpp"
#include "osim/sensors/sensor_registry.hpp"
#include "osim/simulation/json_util.hpp"

#include <chrono>
#include <cmath>
#include <cstring>
#include <limits>

namespace osim {

using json_util::json;
using json_util::value_or;

namespace {

constexpr double kTimeTol = 1e-9;

double elapsed_us(std::chrono::steady_clock::time_point a) {
  return std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - a).count();
}

}  // namespace

const char* to_string(SensorStatus s) {
  switch (s) {
    case SensorStatus::NoSample: return "no-sample";
    case SensorStatus::Used: return "used";
    case SensorStatus::Disabled: return "disabled";
    case SensorStatus::Outage: return "outage";
    case SensorStatus::NotVisible: return "not-visible";
    case SensorStatus::Unsupported: return "unsupported";
    case SensorStatus::Failed: return "failed";
  }
  return "?";
}

Simulation Simulation::from_json(const json& j) { return Simulation(parse_scenario(j)); }

Simulation::Simulation(Scenario sc)
    : sc_(std::move(sc)),
      truth_model_(build_model(sc_.truth)),
      est_model_(build_model(sc_.estimator.model)),
      controls_(sc_.controls, sc_.truth, sc_.estimator.model, sc_.seed) {
  SensorBuildContext ctx{truth_model_.get(), sc_.theta_g0};
  for (const auto& sj : sc_.raw.at("sensors")) {
    auto s = SensorRegistry::instance().create(sj, ctx);
    if (sensor_index(s->id()) >= 0) throw ConfigError("Two sensors share the id '" + s->id() + "'.");
    sensors_.push_back(std::move(s));
  }
  used_.assign(sensors_.size(), 0);
  x_true_ = truth_model_->normalize(sc_.x0_true);

  est_ = EstimatorRegistry::instance().create(sc_.estimator.type, est_model_, sc_.estimator.settings);
  est_->initialize(0.0, sc_.estimator.x0, sc_.estimator.P0);
  for (const auto& why : sensor_support())
    if (!why.empty()) note(why);

  // Node 0 is the initial epoch: no prediction is needed before its update
  pending_ = NodeRecord{};
  pending_.node = 0;
  pending_.t = 0.0;
  pending_.x_prior = est_->mean();
  pending_.P_prior = est_->covariance();
  pending_.u_actual = Vec::Zero(truth_model_->control_dim());
  pending_.u_measured = pending_.u_actual;
}

int Simulation::sensor_index(const std::string& id) const {
  for (size_t i = 0; i < sensors_.size(); ++i)
    if (sensors_[i]->id() == id) return static_cast<int>(i);
  return -1;
}

void Simulation::note(const std::string& msg) {
  for (const auto& m : messages_)
    if (m == msg) return;
  messages_.push_back(msg);
}

std::vector<std::string> Simulation::sensor_support() const {
  std::vector<std::string> out;
  for (const auto& s : sensors_) {
    std::string why = s->unsupported_reason(*est_model_);
    if (why.empty()) why = est_->unsupported_reason(*s);
    out.push_back(why);
  }
  return out;
}

bool Simulation::finished() const { return phase_ == Phase::Predict && t_ >= sc_.duration - kTimeTol; }

double Simulation::next_node_time() const {
  double tn = sc_.duration;
  // Record grid
  const double kg = std::floor((t_ + kTimeTol) / sc_.dt) + 1.0;
  tn = std::min(tn, kg * sc_.dt);
  // Every sensor's sample times (enabled or not: the truth trajectory never depends on toggles)
  for (const auto& s : sensors_) tn = std::min(tn, s->sample_time(s->next_sample_after(t_)));
  // Events and control discontinuities
  for (const auto& e : controls_.spec().impulses)
    if (e.t > t_ + kTimeTol) tn = std::min(tn, e.t);
  for (double b : controls_.boundaries())
    if (b > t_ + kTimeTol) tn = std::min(tn, b);
  return tn;
}

void Simulation::apply_scheduled() {
  if (scheduled_.empty()) return;
  const std::string ph = phase_ == Phase::Predict ? "predict" : "update";
  json remaining = json::array();
  for (const auto& entry : scheduled_) {
    if (entry.at("node").get<long long>() == node_ && entry.at("phase").get<std::string>() == ph) {
      apply_action(entry.at("action"));
    } else {
      remaining.push_back(entry);
    }
  }
  scheduled_ = remaining;
}

void Simulation::step_predict() {
  apply_scheduled();
  if (phase_ != Phase::Predict || finished()) return;
  const double t0 = t_;
  const double t1 = next_node_time();
  const double T = t1 - t0;
  const long long node = node_;  // index of the node being created

  // Controls for this interval, evaluated at its start (zero-order hold)
  const ControlSample c = controls_.sample(t0, x_true_, node);

  // Simulate the spacecraft's true motion
  if (sc_.truth.Qc.cwiseAbs().maxCoeff() > 0.0) {
    const Mat Su = Mat::Zero(truth_model_->control_dim(), truth_model_->control_dim());
    const Propagation p = propagate_variational(*truth_model_, t0, x_true_, c.actual, T, sc_.truth.integrator,
                                                sc_.truth.Qc, Su);
    Rng rng(sc_.seed, "truth-process-noise", static_cast<std::uint64_t>(node));
    x_true_ = p.x + rng.gaussian(cov::safe_cholesky(p.Qd));
  } else {
    x_true_ = propagate(*truth_model_, t0, x_true_, c.actual, T, sc_.truth.integrator);
  }
  x_true_ = truth_model_->normalize(x_true_);
  if (!x_true_.allFinite()) throw std::runtime_error("Truth propagation produced non-finite values.");

  // Run the estimator's prediction (it only sees the measured control)
  const auto t_start = std::chrono::steady_clock::now();
  est_->predict(t1, controls_.for_estimator(c));
  const double us = elapsed_us(t_start);
  t_ = t1;

  pending_ = NodeRecord{};
  pending_.node = node;
  pending_.t = t1;
  pending_.u_actual = c.actual;
  pending_.u_measured = c.measured;
  pending_.predict_us = us;

  // Impulsive maneuvers at t1: after propagation, before the measurements at t1
  for (const auto& e : controls_.spec().impulses) {
    if (std::abs(e.t - t1) > kTimeTol) continue;
    ++impulse_counter_;
    x_true_.segment<3>(3) += controls_.execute_impulse(e, x_true_, impulse_counter_);
    if (e.known) {
      const Mat3 Pdv = e.assumed_sigma.cwiseAbs2().asDiagonal();
      est_->apply_impulse(controls_.commanded_impulse(e, est_->mean()), Pdv);
    }
    pending_.impulse = true;
  }

  pending_.x_prior = est_->mean();
  pending_.P_prior = est_->covariance();
  if (!pending_.x_prior.allFinite() || !pending_.P_prior.allFinite())
    note("The estimator produced non-finite values during prediction (numerical divergence).");
  phase_ = Phase::Update;
}

void Simulation::step_update() {
  apply_scheduled();
  if (phase_ != Phase::Update) return;
  const auto support = sensor_support();
  pending_.sensor_status.assign(sensors_.size(), SensorStatus::NoSample);
  const auto t_start = std::chrono::steady_clock::now();

  for (size_t i = 0; i < sensors_.size(); ++i) {
    const Sensor& s = *sensors_[i];
    const long long k = std::llround((t_ - s.config().phase) / s.config().period);
    if (k < 0 || std::abs(s.sample_time(k) - t_) > kTimeTol) continue;
    SensorStatus& st = pending_.sensor_status[i];
    if (!s.enabled()) {
      st = SensorStatus::Disabled;
      continue;
    }
    if (s.in_outage(t_)) {
      st = SensorStatus::Outage;
      continue;
    }
    if (!s.visible(t_, x_true_)) {
      st = SensorStatus::NotVisible;
      continue;
    }
    if (!support[i].empty()) {
      st = SensorStatus::Unsupported;
      continue;
    }
    // Simulate the measurement from truth with its own noise stream, keyed by the sample
    // time in milliseconds: independent of other sensors, the estimator and cadence changes
    Rng rng(sc_.seed, "sensor:" + s.id(), static_cast<std::uint64_t>(std::llround(t_ * 1000.0)));
    Measurement m{static_cast<int>(i), s.id(), t_, k, s.simulate(t_, x_true_, rng)};
    // Run the estimator's measurement update
    const UpdateResult r = est_->update(s, m);
    if (r.status == UpdateResult::Status::Applied) {
      st = SensorStatus::Used;
      ++used_[i];
      InnovationRecord ir;
      ir.node = node_;
      ir.t = t_;
      ir.sensor = static_cast<int>(i);
      ir.sample = k;
      ir.z = m.z;
      ir.nu = r.innovation;
      ir.sigma = r.S.diagonal().cwiseMax(0.0).cwiseSqrt();
      ir.nis = r.nis;
      innovations_.push_back(std::move(ir));
      if (!r.message.empty()) note(r.message);
    } else {
      st = r.status == UpdateResult::Status::Unsupported ? SensorStatus::Unsupported : SensorStatus::Failed;
      if (!r.message.empty()) note(r.message);
    }
  }
  pending_.update_us = elapsed_us(t_start);
  record_node();
  phase_ = Phase::Predict;
}

void Simulation::record_node() {
  NodeRecord& r = pending_;
  r.x_true = x_true_;
  r.x_est = est_->mean();
  r.P = est_->covariance();
  r.err = truth_model_->state_difference(x_true_, r.x_est);
  r.ess = est_->stats().ess;
  Eigen::LDLT<Mat> ldlt(r.P);
  r.nees = (ldlt.info() == Eigen::Success && ldlt.isPositive()) ? r.err.dot(ldlt.solve(r.err))
                                                                : std::numeric_limits<double>::quiet_NaN();
  if (truth_model_->is_inertial_orbit()) {
    const Mat3 C = frames::rtn_basis(x_true_.head<3>(), x_true_.segment<3>(3));
    r.err_rtn = C * r.err.head<3>();
    r.sigma_rtn = (C * r.P.topLeftCorner<3, 3>() * C.transpose()).diagonal().cwiseMax(0.0).cwiseSqrt();
  } else {
    r.err_rtn = r.err.head<3>();
    r.sigma_rtn = r.P.topLeftCorner<3, 3>().diagonal().cwiseMax(0.0).cwiseSqrt();
  }
  if (auto w = est_model_->singularity_warning(r.x_est); !w.empty()) note(w);
  history_.push_back(std::move(r));
  pending_ = NodeRecord{};
  // Node k is stored at history_[k]; node_ is the index of the next node to be created
  node_ = static_cast<long long>(history_.size());
}

void Simulation::step() {
  if (phase_ == Phase::Predict) step_predict();
  if (phase_ == Phase::Update) step_update();
}

void Simulation::run_until(double t) {
  while (!finished() && (phase_ == Phase::Update || next_node_time() <= t + kTimeTol)) step();
}

void Simulation::run_to_end() {
  while (!finished()) step();
}

void Simulation::build_estimator(const std::string& type, const json& params, bool handoff) {
  json ej = sc_.raw.at("estimator");
  ej["type"] = type;
  for (const char* key : {"ukf", "pf", "kf", "seed"})
    if (params.contains(key)) ej[key] = params.at(key);
  EstimatorSpec spec = parse_estimator_spec(ej, sc_.truth, sc_.x0_true);
  // Keep the current tuning of Q and Σu
  spec.settings.Qc = est_->settings().Qc;
  spec.settings.Sigma_u = est_->settings().Sigma_u;
  const Vec x = est_->mean();
  const Mat P = est_->covariance();
  const double t = est_->time();
  est_ = EstimatorRegistry::instance().create(type, est_model_, spec.settings);
  if (handoff) est_->initialize(t, x, P);
  sc_.raw["estimator"] = ej;
  sc_.estimator.type = type;
  sc_.estimator.settings = spec.settings;
}

void Simulation::apply_action(const json& a) {
  const std::string type = a.at("type").get<std::string>();
  auto sensor = [&]() -> Sensor& {
    const int i = sensor_index(a.at("sensor").get<std::string>());
    if (i < 0) throw ConfigError("No sensor with id '" + a.at("sensor").get<std::string>() + "'.");
    return *sensors_[i];
  };
  if (type == "setSensorEnabled") {
    sensor().set_enabled(a.at("enabled").get<bool>());
  } else if (type == "setSensorAssumedNoise" || type == "setSensorTrueNoise") {
    Sensor& s = sensor();
    Mat R;
    if (!json_util::read_covariance(a, "", s.dim(), "noise of sensor '" + s.id() + "'", R)) {
      if (a.contains("sigma"))
        R = json_util::get_vec(a.at("sigma"), s.dim(), "sigma").cwiseAbs2().asDiagonal();
      else if (a.contains("covariance"))
        R = json_util::get_mat(a.at("covariance"), s.dim(), "covariance");
      else
        throw ConfigError("Noise action needs \"sigma\" or \"covariance\".");
    }
    if (type == "setSensorAssumedNoise")
      s.set_R_assumed(R);
    else
      s.set_R_true(R);
  } else if (type == "setSensorPeriod") {
    sensor().set_period(a.at("period").get<double>(), t_);
  } else if (type == "setSensorOutages") {
    std::vector<Interval> o;
    for (const auto& iv : a.at("outages")) o.push_back({iv.at(0).get<double>(), iv.at(1).get<double>()});
    sensor().set_outages(o);
  } else if (type == "setProcessNoise") {
    const int p = est_model_->noise_dim();
    Mat Q = a.contains("covariance") ? json_util::get_mat(a.at("covariance"), p, "process-noise PSD")
                                     : Mat(json_util::get_vec(a.at("psd"), p, "process-noise PSD").asDiagonal());
    est_->set_process_noise(Q);
  } else if (type == "addImpulse") {
    // Reuse the scenario parser so a new burn is validated exactly like a scripted one
    json s = sc_.raw;
    s["controls"] = json{{"impulses", json::array({a.at("impulse")})}};
    const ImpulseEvent e = parse_scenario(s).controls.impulses.at(0);
    if (e.t <= t_ + kTimeTol) throw ConfigError("A new burn must be scheduled after the current time.");
    controls_.spec().impulses.push_back(e);
  } else if (type == "addThrustSegment") {
    json s = sc_.raw;
    s["controls"] = json{{"segments", json::array({a.at("segment")})}};
    const ThrustSegment seg = parse_scenario(s).controls.segments.at(0);
    if (seg.start < t_ - kTimeTol) throw ConfigError("A new thrust arc must start at or after the current time.");
    controls_.spec().segments.push_back(seg);
  } else if (type == "setEstimatorKnowsThrust") {
    controls_.spec().estimator_knows_thrust = a.at("value").get<bool>();
  } else if (type == "switchEstimator") {
    build_estimator(a.at("estimator").get<std::string>(), a, true);
    for (const auto& why : sensor_support())
      if (!why.empty()) note(why);
  } else {
    throw ConfigError("Unknown action '" + type + "'.");
  }
  // Live and replayed actions are logged identically, so a replay's log equals the original
  action_log_.push_back({{"node", node_}, {"phase", phase_ == Phase::Predict ? "predict" : "update"}, {"action", a}});
}

void Simulation::schedule_actions(const json& log) {
  for (const auto& e : log) scheduled_.push_back(e);
  apply_scheduled();
}

std::uint64_t Simulation::history_hash() const {
  std::uint64_t h = 0xcbf29ce484222325ULL;
  auto mix = [&h](double v) {
    std::uint64_t b;
    std::memcpy(&b, &v, sizeof b);
    for (int i = 0; i < 8; ++i) {
      h ^= (b >> (8 * i)) & 0xffU;
      h *= 0x100000001b3ULL;
    }
  };
  for (const auto& r : history_) {
    mix(r.t);
    for (int i = 0; i < r.x_true.size(); ++i) mix(r.x_true[i]);
    for (int i = 0; i < r.x_est.size(); ++i) mix(r.x_est[i]);
    for (int i = 0; i < r.P.size(); ++i) mix(r.P.data()[i]);
    for (auto s : r.sensor_status) mix(static_cast<double>(s));
  }
  for (const auto& r : innovations_) {
    mix(r.t);
    for (int i = 0; i < r.nu.size(); ++i) mix(r.nu[i]);
    mix(r.nis);
  }
  return h;
}

}  // namespace osim
