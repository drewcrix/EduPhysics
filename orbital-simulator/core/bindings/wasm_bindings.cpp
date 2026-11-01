/**
 * WebAssembly bindings (Emscripten embind) — the only interface the browser uses.
 *
 * Contract:
 *   - Methods never throw into JavaScript; failures return {"ok": false, "error": "..."}.
 *   - Metadata, summaries and diagnostics are JSON strings (small, infrequent).
 *   - History and innovations are packed Float64Arrays (large, streamed incrementally);
 *     the record layout is described by meta.layout so the frontend never hard-codes it.
 *   - Simulation time is advanced only by explicit calls, so rendering frame rate and
 *     playback speed cannot change results.
 */

#include "osim/diagnostics/ellipsoid.hpp"
#include "osim/diagnostics/metrics.hpp"
#include "osim/diagnostics/observability.hpp"
#include "osim/diagnostics/statistics.hpp"
#include "osim/estimators/estimator_registry.hpp"
#include "osim/estimators/particle_filter.hpp"
#include "osim/sensors/ground_station.hpp"
#include "osim/constants.hpp"
#include "osim/sensors/sensor_registry.hpp"
#include "osim/simulation/json_util.hpp"
#include "osim/simulation/simulation.hpp"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cmath>
#include <limits>
#include <memory>

using namespace osim;
using nlohmann::json;

namespace {

const char* quantity_name(Quantity q) {
  switch (q) {
    case Quantity::Position: return "position";
    case Quantity::Velocity: return "velocity";
    case Quantity::Angle: return "angle";
    case Quantity::AngularRate: return "rate";
    case Quantity::Range: return "range";
    default: return "other";
  }
}

json labels_json(const std::vector<ComponentLabel>& l) {
  json a = json::array();
  for (const auto& c : l) a.push_back({{"name", c.name}, {"unit", c.unit}, {"quantity", quantity_name(c.quantity)}});
  return a;
}

double num(double v) { return std::isfinite(v) ? v : std::numeric_limits<double>::quiet_NaN(); }

json err(const std::string& m) { return {{"ok", false}, {"error", m}}; }

emscripten::val to_f64(const std::vector<double>& v) {
  emscripten::val out = emscripten::val::global("Float64Array").new_(v.size());
  out.call<void>("set", emscripten::val(emscripten::typed_memory_view(v.size(), v.data())));
  return out;
}

constexpr int kMaxMeasDim = 6;

}  // namespace

class WasmSimulation {
 public:
  std::string init(const std::string& scenario) {
    try {
      sim_ = std::make_unique<Simulation>(Simulation::from_json(json::parse(scenario)));
      return json{{"ok", true}, {"meta", meta()}}.dump();
    } catch (const std::exception& e) {
      sim_.reset();
      return err(e.what()).dump();
    }
  }

  std::string step(int nodes, int mode) {
    return guard([&] {
      for (int i = 0; i < nodes && !sim_->finished(); ++i) {
        if (mode == 1)
          sim_->step_predict();
        else if (mode == 2)
          sim_->step_update();
        else
          sim_->step();
      }
      return status();
    });
  }

  std::string runUntil(double t) {
    return guard([&] {
      sim_->run_until(t);
      return status();
    });
  }

  std::string action(const std::string& a) {
    return guard([&] {
      sim_->apply_action(json::parse(a));
      json s = status();
      s["meta"] = meta();
      return s;
    });
  }

  std::string scheduleActions(const std::string& log) {
    return guard([&] {
      sim_->schedule_actions(json::parse(log));
      return status();
    });
  }

  /// Packed node records from index `from` (see meta.layout.record).
  emscripten::val history(int from) {
    std::vector<double> out;
    if (!sim_) return to_f64(out);
    const auto& H = sim_->history();
    const int n = sim_->truth_model().state_dim();
    for (size_t k = std::max(0, from); k < H.size(); ++k) {
      const NodeRecord& r = H[k];
      out.push_back(r.t);
      out.push_back(static_cast<double>(r.node));
      for (int i = 0; i < n; ++i) out.push_back(r.x_true[i]);
      for (int i = 0; i < n; ++i) out.push_back(r.x_est[i]);
      for (int i = 0; i < n; ++i) out.push_back(r.x_prior[i]);
      for (int i = 0; i < n; ++i) out.push_back(std::sqrt(std::max(0.0, r.P(i, i))));
      for (int i = 0; i < n; ++i) out.push_back(std::sqrt(std::max(0.0, r.P_prior(i, i))));
      for (int i = 0; i < 3; ++i)
        for (int j = i; j < 3; ++j) out.push_back(r.P(i, j));
      for (int i = 0; i < n; ++i) out.push_back(r.err[i]);
      out.push_back(num(r.nees));
      for (int i = 0; i < 3; ++i) out.push_back(r.err_rtn[i]);
      for (int i = 0; i < 3; ++i) out.push_back(r.sigma_rtn[i]);
      for (int i = 0; i < r.u_actual.size(); ++i) out.push_back(r.u_actual[i]);
      for (int i = 0; i < r.u_measured.size(); ++i) out.push_back(r.u_measured[i]);
      out.push_back(r.impulse ? 1.0 : 0.0);
      out.push_back(r.ess);
      out.push_back(r.predict_us);
      out.push_back(r.update_us);
      for (size_t s = 0; s < sim_->sensors().size(); ++s)
        out.push_back(s < r.sensor_status.size() ? static_cast<double>(r.sensor_status[s]) : 0.0);
    }
    return to_f64(out);
  }

  /// Packed innovation records [t, node, sensor, dim, nis, nu×6, sigma×6] from index `from`.
  emscripten::val innovations(int from) {
    std::vector<double> out;
    if (!sim_) return to_f64(out);
    const auto& I = sim_->innovations();
    for (size_t k = std::max(0, from); k < I.size(); ++k) {
      const auto& r = I[k];
      out.push_back(r.t);
      out.push_back(static_cast<double>(r.node));
      out.push_back(r.sensor);
      out.push_back(static_cast<double>(r.nu.size()));
      out.push_back(r.nis);
      for (int i = 0; i < kMaxMeasDim; ++i) out.push_back(i < r.nu.size() ? r.nu[i] : 0.0);
      for (int i = 0; i < kMaxMeasDim; ++i) out.push_back(i < r.sigma.size() ? r.sigma[i] : 0.0);
    }
    return to_f64(out);
  }

  std::string summary() {
    return guard([&] { return run_summary(*sim_); });
  }

  std::string observability(double window) {
    return guard([&] {
      const auto r = local_observability(*sim_, window);
      json sv = json::array(), bs = json::array(), un = json::array();
      for (int i = 0; i < r.singular_values.size(); ++i) sv.push_back(r.singular_values[i]);
      for (int i = 0; i < r.best_sigma.size(); ++i) bs.push_back(std::isfinite(r.best_sigma[i]) ? json(r.best_sigma[i]) : json(nullptr));
      for (bool b : r.unobservable) un.push_back(b);
      return json{{"ok", true},           {"t0", r.t0},
                  {"window", r.window},   {"stateDim", r.state_dim},
                  {"rows", r.measurements}, {"rank", r.rank},
                  {"condition", std::isfinite(r.condition) ? json(r.condition) : json(nullptr)},
                  {"singularValues", sv}, {"bestSigma", bs},
                  {"unobservable", un},   {"weakDirections", r.weak_directions},
                  {"notes", r.notes}};
    });
  }

  /// Joint confidence ellipsoid of the estimated position at history index k.
  std::string ellipsoid(int k, double confidence) {
    return guard([&] {
      const auto& H = sim_->history();
      if (k < 0 || k >= static_cast<int>(H.size())) throw ConfigError("No such history record.");
      const auto e = confidence_region(H[k].x_est.head<3>(), H[k].P.topLeftCorner<3, 3>(), confidence);
      return json{{"ok", true}, {"center", json_util::to_json(e.center)}, {"semiAxes", json_util::to_json(e.semi_axes)},
                  {"axes", json_util::to_json(e.axes)}, {"k2", e.k2}, {"confidence", confidence}};
    });
  }

  /// Estimated trajectory propagated forward from the current estimate (planned control).
  emscripten::val predictTrajectory(double horizon, int points) {
    std::vector<double> out;
    if (!sim_ || points < 2) return to_f64(out);
    try {
      const auto& model = sim_->estimator_model();
      Vec x = sim_->estimator().mean();
      double t = sim_->time();
      const double dt = horizon / (points - 1);
      IntegratorConfig cfg = sim_->estimator().settings().integrator;
      cfg.max_step = std::min(cfg.max_step, 30.0);
      for (int k = 0; k < points; ++k) {
        for (int i = 0; i < 3; ++i) out.push_back(x[i]);
        x = propagate(model, t, x, sim_->controls().planned(t, x), dt, cfg);
        t += dt;
      }
    } catch (const std::exception&) {
      out.clear();
    }
    return to_f64(out);
  }

  /// Up to `max` particle positions (x, y, z, weight) when the estimator is a particle filter.
  emscripten::val particles(int max) {
    std::vector<double> out;
    if (!sim_) return to_f64(out);
    if (const auto* pf = dynamic_cast<const ParticleFilter*>(&sim_->estimator())) {
      const Mat& X = pf->particles();
      const Vec w = pf->weights();
      const int N = static_cast<int>(X.cols());
      const int stride = std::max(1, N / std::max(1, max));
      for (int i = 0; i < N; i += stride) {
        for (int j = 0; j < 3; ++j) out.push_back(X(j, i));
        out.push_back(w[i]);
      }
    }
    return to_f64(out);
  }

  std::string actionLog() const { return sim_ ? sim_->action_log().dump() : "[]"; }
  std::string hash() const { return sim_ ? std::to_string(sim_->history_hash()) : "0"; }
  int historySize() const { return sim_ ? static_cast<int>(sim_->history().size()) : 0; }
  int innovationSize() const { return sim_ ? static_cast<int>(sim_->innovations().size()) : 0; }

 private:
  template <typename F>
  std::string guard(F&& f) {
    if (!sim_) return err("No scenario loaded.").dump();
    try {
      json r = f();
      if (!r.contains("ok")) r["ok"] = true;
      return r.dump();
    } catch (const std::exception& e) {
      return err(e.what()).dump();
    }
  }

  json status() const {
    return {{"ok", true},
            {"t", sim_->time()},
            {"node", sim_->node_index()},
            {"phase", sim_->next_phase() == Simulation::Phase::Predict ? "predict" : "update"},
            {"finished", sim_->finished()},
            {"nextNodeTime", sim_->finished() ? sim_->time() : sim_->next_node_time()},
            {"historySize", sim_->history().size()},
            {"innovationSize", sim_->innovations().size()},
            {"messages", sim_->messages()}};
  }

  json meta() const {
    const auto& sc = sim_->scenario();
    const auto& tm = sim_->truth_model();
    const int n = tm.state_dim(), m = tm.control_dim(), S = static_cast<int>(sim_->sensors().size());
    json sensors = json::array();
    const auto support = sim_->sensor_support();
    for (int i = 0; i < S; ++i) {
      const Sensor& s = *sim_->sensors()[i];
      json outages = json::array();
      for (const auto& o : s.config().outages) outages.push_back({o.start, o.end});
      json sj = {{"id", s.id()},
                 {"name", s.config().name},
                 {"type", s.type()},
                 {"dim", s.dim()},
                 {"labels", labels_json(s.labels())},
                 {"enabled", s.enabled()},
                 {"period", s.config().period},
                 {"phase", s.config().phase},
                 {"cost", s.config().cost},
                 {"outages", outages},
                 {"trueCovariance", json_util::to_json(s.R_true())},
                 {"assumedCovariance", json_util::to_json(s.R_assumed())},
                 {"linear", s.is_linear()},
                 {"unsupported", support[i]}};
      if (const auto* gs = dynamic_cast<const GroundStationSensor*>(&s)) {
        const auto& site = gs->site();
        sj["station"] = {{"name", site.name},
                         {"latDeg", site.lat / constants::DEG},
                         {"lonDeg", site.lon / constants::DEG},
                         {"altM", site.alt},
                         {"minElevationDeg", site.min_elevation / constants::DEG}};
      }
      sensors.push_back(sj);
    }
    json est = json::array();
    for (const auto& e : EstimatorRegistry::instance().list())
      est.push_back({{"type", e.type}, {"name", e.display_name}, {"summary", e.summary}, {"stochastic", e.stochastic}});
    json impulses = json::array();
    for (const auto& e : sim_->controls().spec().impulses)
      impulses.push_back({{"label", e.label}, {"t", e.t}, {"dv", json_util::to_json(Vec(e.dv))}, {"frame", e.frame}, {"known", e.known}});
    json segments = json::array();
    for (const auto& s : sim_->controls().spec().segments)
      segments.push_back({{"label", s.label}, {"start", s.start}, {"end", s.end}, {"thrustN", s.thrust}, {"frame", s.frame}});
    const int rec = 2 + 6 * n + 6 + 1 + 6 + 2 * m + 4 + S;
    return {{"id", sc.id},
            {"name", sc.name},
            {"description", sc.description},
            {"model", sc.truth.kind},
            {"epoch", sc.epoch},
            {"duration", sc.duration},
            {"dt", sc.dt},
            {"seed", sc.seed},
            {"greenwichAngleAtEpochRad", sc.theta_g0},
            {"mu", sc.truth.mu},
            {"stateLabels", labels_json(tm.state_labels())},
            {"controlLabels", labels_json(tm.control_labels())},
            {"noiseLabels", labels_json(tm.noise_labels())},
            {"sensors", sensors},
            {"estimator",
             {{"type", sim_->estimator().type()},
              {"name", sim_->estimator().display_name()},
              {"processNoise", json_util::to_json(sim_->estimator().settings().Qc)}}},
            {"estimators", est},
            {"impulses", impulses},
            {"segments", segments},
            {"estimatorKnowsThrust", sim_->controls().spec().estimator_knows_thrust},
            {"layout",
             {{"record", rec},
              {"stateDim", n},
              {"controlDim", m},
              {"sensorCount", S},
              {"innovation", 5 + 2 * kMaxMeasDim},
              {"maxMeasDim", kMaxMeasDim}}}};
  }

  std::unique_ptr<Simulation> sim_;
};

double chi2_quantile_js(double p, double k) {
  try {
    return stats::chi2_quantile(p, k);
  } catch (...) {
    return std::numeric_limits<double>::quiet_NaN();
  }
}

std::string list_estimators() {
  json a = json::array();
  for (const auto& e : EstimatorRegistry::instance().list())
    a.push_back({{"type", e.type}, {"name", e.display_name}, {"summary", e.summary}, {"stochastic", e.stochastic}});
  return a.dump();
}

std::string list_sensors() {
  json a = json::array();
  for (const auto& [k, v] : SensorRegistry::instance().entries()) a.push_back({{"type", k}, {"description", v.description}});
  return a.dump();
}

EMSCRIPTEN_BINDINGS(osim) {
  emscripten::class_<WasmSimulation>("Simulation")
      .constructor<>()
      .function("init", &WasmSimulation::init)
      .function("step", &WasmSimulation::step)
      .function("runUntil", &WasmSimulation::runUntil)
      .function("action", &WasmSimulation::action)
      .function("scheduleActions", &WasmSimulation::scheduleActions)
      .function("history", &WasmSimulation::history)
      .function("innovations", &WasmSimulation::innovations)
      .function("summary", &WasmSimulation::summary)
      .function("observability", &WasmSimulation::observability)
      .function("ellipsoid", &WasmSimulation::ellipsoid)
      .function("predictTrajectory", &WasmSimulation::predictTrajectory)
      .function("particles", &WasmSimulation::particles)
      .function("actionLog", &WasmSimulation::actionLog)
      .function("hash", &WasmSimulation::hash)
      .function("historySize", &WasmSimulation::historySize)
      .function("innovationSize", &WasmSimulation::innovationSize);
  emscripten::function("chi2Quantile", &chi2_quantile_js);
  emscripten::function("listEstimators", &list_estimators);
  emscripten::function("listSensors", &list_sensors);
}
