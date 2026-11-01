#include "osim/diagnostics/metrics.hpp"

#include "osim/constants.hpp"
#include "osim/diagnostics/statistics.hpp"

#include <cmath>

namespace osim {

using nlohmann::json;

namespace {

double rms(const std::vector<double>& v) {
  if (v.empty()) return 0.0;
  double s = 0.0;
  for (double x : v) s += x * x;
  return std::sqrt(s / static_cast<double>(v.size()));
}

double finite_or_null(double v) { return std::isfinite(v) ? v : -1.0; }

}  // namespace

json run_summary(const Simulation& sim, double tail_fraction) {
  const auto& H = sim.history();
  const auto& model = sim.truth_model();
  const int n = model.state_dim();
  json out;
  const auto& est = sim.estimator();
  out["estimator"] = {{"type", est.type()}, {"name", est.display_name()}};
  out["nodes"] = H.size();
  out["time"] = H.empty() ? 0.0 : H.back().t;
  out["finished"] = sim.finished();
  if (H.empty()) return out;

  const double t_end = H.back().t;
  const double t_tail = t_end * (1.0 - tail_fraction);
  std::vector<double> pe, pe_tail, ve, ae, we;
  double pmax = 0.0;
  double nees_sum = 0.0, nees_in = 0.0;
  long long nees_n = 0;
  const double lo95 = stats::chi2_quantile(0.025, n), hi95 = stats::chi2_quantile(0.975, n);
  for (const auto& r : H) {
    const double p = r.err.head<3>().norm();
    pe.push_back(p);
    pmax = std::max(pmax, p);
    if (r.t >= t_tail) pe_tail.push_back(p);
    ve.push_back(r.err.segment<3>(3).norm());
    if (model.has_attitude()) {
      ae.push_back(r.err.segment<3>(6).norm());
      we.push_back(r.err.segment<3>(9).norm());
    }
    if (std::isfinite(r.nees)) {
      nees_sum += r.nees;
      ++nees_n;
      if (r.nees >= lo95 && r.nees <= hi95) nees_in += 1.0;
    }
  }
  json acc;
  acc["positionRms"] = rms(pe);
  acc["positionRmsTail"] = rms(pe_tail);
  acc["positionFinal"] = pe.back();
  acc["positionMax"] = pmax;
  acc["velocityRms"] = rms(ve);
  acc["velocityFinal"] = ve.back();
  acc["finalSigmaPosition"] = std::sqrt(std::max(0.0, H.back().P.topLeftCorner<3, 3>().trace()));
  if (model.has_attitude()) {
    acc["attitudeRmsDeg"] = rms(ae) / constants::DEG;
    acc["rateRms"] = rms(we);
  }
  out["accuracy"] = acc;

  json cal;
  cal["stateDim"] = n;
  cal["neesSamples"] = nees_n;
  if (nees_n > 0) {
    const double anees = nees_sum / static_cast<double>(nees_n);
    const auto b = stats::average_chi2_bounds(n, nees_n, 0.95);
    cal["anees"] = anees;
    cal["aneesPerDim"] = anees / n;
    cal["aneesBounds95"] = {b.lower, b.upper};
    cal["fractionNeesIn95"] = nees_in / static_cast<double>(nees_n);
    const double ratio = anees / n;
    // Single-run time averages of NEES are strongly autocorrelated (few effective samples):
    // a consistent EKF gives 0.34–2.1 across seeds on First Fix, so the band is [1/3, 3]
    cal["verdict"] = ratio > 3.0 ? "overconfident" : (ratio < 1.0 / 3.0 ? "underconfident" : "consistent");
  }
  // NIS: per-sensor and overall (normalised by measurement dimension)
  const auto& sensors = sim.sensors();
  std::vector<double> nis_sum(sensors.size(), 0.0);
  std::vector<long long> nis_n(sensors.size(), 0);
  double nis_norm = 0.0;
  long long nis_all = 0;
  long long nis_in = 0;
  for (const auto& ir : sim.innovations()) {
    nis_sum[ir.sensor] += ir.nis;
    ++nis_n[ir.sensor];
    const int d = static_cast<int>(ir.nu.size());
    nis_norm += ir.nis / d;
    ++nis_all;
    if (ir.nis >= stats::chi2_quantile(0.025, d) && ir.nis <= stats::chi2_quantile(0.975, d)) ++nis_in;
  }
  if (nis_all > 0) {
    cal["anisPerDim"] = nis_norm / static_cast<double>(nis_all);
    cal["fractionNisIn95"] = static_cast<double>(nis_in) / static_cast<double>(nis_all);
  }
  out["calibration"] = cal;

  json res = json::array();
  double cost = 0.0;
  for (size_t i = 0; i < sensors.size(); ++i) {
    const double c = sensors[i]->config().cost * static_cast<double>(sim.measurements_used()[i]);
    cost += c;
    json s = {{"id", sensors[i]->id()},
              {"type", sensors[i]->type()},
              {"used", sim.measurements_used()[i]},
              {"cost", c}};
    if (nis_n[i] > 0) {
      s["meanNis"] = nis_sum[i] / static_cast<double>(nis_n[i]);
      s["dim"] = sensors[i]->dim();
    }
    res.push_back(s);
  }
  out["resources"] = {{"sensors", res}, {"totalCost", cost}};

  double pred_us = 0.0, upd_us = 0.0;
  for (const auto& r : H) {
    pred_us += r.predict_us;
    upd_us += r.update_us;
  }
  const auto& st = est.stats();
  out["compute"] = {{"dynamicsEvaluations", est.model().f_evaluations()},
                    {"jacobianEvaluations", est.model().jacobian_evaluations()},
                    {"predictMs", pred_us / 1000.0},
                    {"updateMs", upd_us / 1000.0},
                    {"particles", st.particles},
                    {"ess", finite_or_null(st.ess)},
                    {"resamples", st.resamples},
                    {"collapses", st.collapses},
                    {"degeneracyFallbacks", st.degeneracy_fallbacks},
                    {"psdRepairs", st.psd_repairs}};
  out["messages"] = sim.messages();
  out["hash"] = std::to_string(sim.history_hash());
  return out;
}

}  // namespace osim
