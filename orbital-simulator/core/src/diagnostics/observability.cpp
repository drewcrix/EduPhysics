#include "osim/diagnostics/observability.hpp"

#include <Eigen/SVD>

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <limits>
#include <sstream>

namespace osim {

double characteristic_scale(Quantity q) {
  switch (q) {
    case Quantity::Position: return 1000.0;   // 1 km
    case Quantity::Velocity: return 1.0;      // 1 m/s
    case Quantity::Angle: return 0.01;        // ~0.57°
    case Quantity::AngularRate: return 1e-4;  // rad/s
    default: return 1.0;
  }
}

ObservabilityReport local_observability(const DynamicsModel& model, const IntegratorConfig& integ, double t0,
                                        const Vec& x0, double window, const std::vector<const Sensor*>& sensors,
                                        const ControlModel* controls) {
  const int n = model.state_dim();
  ObservabilityReport rep;
  rep.t0 = t0;
  rep.window = window;
  rep.state_dim = n;

  const auto labels = model.state_labels();
  Vec scale(n);
  for (int i = 0; i < n; ++i) scale[i] = characteristic_scale(labels[i].quantity);

  // Collect all planned sample times in the window
  std::vector<double> times{t0};
  for (const Sensor* s : sensors) {
    for (long long k = s->next_sample_after(t0 - 1e-6); s->sample_time(k) <= t0 + window + 1e-9; ++k)
      times.push_back(s->sample_time(k));
  }
  std::sort(times.begin(), times.end());
  times.erase(std::unique(times.begin(), times.end(), [](double a, double b) { return std::abs(a - b) < 1e-9; }),
              times.end());

  std::vector<Mat> blocks;
  Vec x = x0;
  Mat Phi = Mat::Identity(n, n);
  double t = t0;
  const Mat Qz = Mat::Zero(model.noise_dim(), model.noise_dim());
  const Mat Uz = Mat::Zero(model.control_dim(), model.control_dim());
  for (double ti : times) {
    if (ti > t + 1e-12) {
      const Vec u = controls ? controls->planned(t, x) : Vec::Zero(model.control_dim());
      const Propagation p = propagate_variational(model, t, x, u, ti - t, integ, Qz, Uz);
      x = p.x;
      Phi = p.Phi * Phi;
      t = ti;
    }
    for (const Sensor* s : sensors) {
      const long long k = std::llround((ti - s->config().phase) / s->config().period);
      if (k < 0 || std::abs(s->sample_time(k) - ti) > 1e-9) continue;
      if (s->in_outage(ti) || !s->visible(ti, x)) continue;
      // Whiten by the assumed noise: R^{-1/2} H Φ S
      const Mat L = Eigen::LLT<Mat>(s->filter_covariance(x)).matrixL();
      blocks.push_back(L.triangularView<Eigen::Lower>().solve(s->H(ti, x) * Phi) * scale.asDiagonal());
    }
  }

  int rows = 0;
  for (const auto& b : blocks) rows += static_cast<int>(b.rows());
  rep.measurements = rows;
  rep.singular_values = Vec::Zero(n);
  rep.best_sigma = Vec::Constant(n, std::numeric_limits<double>::infinity());
  rep.unobservable.assign(n, true);
  if (rows == 0) {
    rep.condition = std::numeric_limits<double>::infinity();
    rep.notes.push_back("No measurements are available in this window: nothing is observable, the filter can only "
                        "dead-reckon.");
    rep.weak_directions.push_back("all states");
    return rep;
  }
  Mat O(rows, n);
  int r0 = 0;
  for (const auto& b : blocks) {
    O.middleRows(r0, b.rows()) = b;
    r0 += static_cast<int>(b.rows());
  }

  Eigen::JacobiSVD<Mat> svd(O, Eigen::ComputeFullV);
  const Vec sv = svd.singularValues();
  rep.singular_values.head(sv.size()) = sv;
  const double smax = sv.size() ? sv[0] : 0.0;
  const double tol = 1e-9 * smax;
  rep.rank = 0;
  for (int i = 0; i < sv.size(); ++i)
    if (sv[i] > tol) ++rep.rank;
  rep.condition = rep.rank > 0 ? smax / sv[rep.rank - 1] : std::numeric_limits<double>::infinity();

  const Mat V = svd.matrixV();
  // Pseudo-inverse information bound on the observable subspace
  Vec var = Vec::Zero(n);
  for (int i = 0; i < rep.rank; ++i) var += (V.col(i).cwiseAbs2() / (sv[i] * sv[i]));
  for (int i = 0; i < n; ++i) {
    double null_weight = 0.0;
    for (int k = rep.rank; k < n; ++k) null_weight += V(i, k) * V(i, k);
    rep.unobservable[i] = null_weight > 1e-6;
    rep.best_sigma[i] = rep.unobservable[i] ? std::numeric_limits<double>::infinity() : std::sqrt(var[i]) * scale[i];
  }

  // Describe null-space directions and very weak ones (σ_i < 10⁻⁶ σ_max)
  for (int k = 0; k < n; ++k) {
    const bool null_dir = k >= rep.rank;
    const bool weak = !null_dir && k < sv.size() && sv[k] < 1e-6 * smax;
    if (!null_dir && !weak) continue;
    std::vector<std::pair<double, int>> comp;
    for (int i = 0; i < n; ++i) comp.push_back({std::abs(V(i, k)), i});
    std::sort(comp.rbegin(), comp.rend());
    std::ostringstream os;
    os << (null_dir ? "unobservable: " : "weak: ");
    int shown = 0;
    for (const auto& [w, i] : comp) {
      if (w < 0.15 || shown == 3) break;
      os << (shown ? " + " : "") << std::fixed << std::setprecision(2) << w << "·" << labels[i].name;
      ++shown;
    }
    rep.weak_directions.push_back(os.str());
  }
  if (rep.rank < n)
    rep.notes.push_back("Rank " + std::to_string(rep.rank) + " of " + std::to_string(n) +
                        ": some state directions produce no change in any measurement in this window.");
  return rep;
}

ObservabilityReport local_observability(const Simulation& sim, double window) {
  std::vector<const Sensor*> active;
  const auto support = sim.sensor_support();
  for (size_t i = 0; i < sim.sensors().size(); ++i)
    if (sim.sensors()[i]->enabled() && support[i].empty()) active.push_back(sim.sensors()[i].get());
  return local_observability(sim.estimator_model(), sim.estimator().settings().integrator, sim.time(),
                             sim.estimator().mean(), window, active, &sim.controls());
}

}  // namespace osim
