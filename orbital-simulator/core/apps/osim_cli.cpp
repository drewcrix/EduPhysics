/**
 * Headless command-line runner for Mission Control Academy scenarios.
 *
 *   osim_cli <scenario.json> [--estimator TYPE] [--csv FILE] [--observability WINDOW_S]
 *   osim_cli --check-all <scenario-dir>
 *   osim_cli --list
 *
 * Prints the run summary (accuracy, calibration, cost, replay hash) as JSON.
 */

#include "osim/diagnostics/metrics.hpp"
#include "osim/diagnostics/observability.hpp"
#include "osim/estimators/estimator_registry.hpp"
#include "osim/sensors/sensor_registry.hpp"
#include "osim/simulation/simulation.hpp"

#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>

using namespace osim;
using nlohmann::json;

namespace {

json load_json(const std::string& path) {
  std::ifstream f(path);
  if (!f) throw ConfigError("Cannot open " + path);
  json j;
  f >> j;
  return j;
}

void write_csv(const Simulation& sim, const std::string& path) {
  std::ofstream f(path);
  const auto labels = sim.truth_model().state_labels();
  f << "t";
  for (const auto& l : labels) f << ",true_" << l.name << ",est_" << l.name << ",sigma_" << l.name;
  f << ",nees\n";
  f << std::setprecision(17);
  for (const auto& r : sim.history()) {
    f << r.t;
    for (int i = 0; i < r.x_true.size(); ++i)
      f << "," << r.x_true[i] << "," << r.x_est[i] << "," << std::sqrt(std::max(0.0, r.P(i, i)));
    f << "," << r.nees << "\n";
  }
}

int check_all(const std::string& dir) {
  int failures = 0, count = 0;
  std::vector<std::filesystem::path> files;
  for (const auto& e : std::filesystem::directory_iterator(dir))
    if (e.path().extension() == ".json") files.push_back(e.path());
  std::sort(files.begin(), files.end());
  for (const auto& p : files) {
    ++count;
    try {
      Simulation sim = Simulation::from_json(load_json(p.string()));
      sim.run_to_end();
      const auto& last = sim.history().back();
      const bool finite = last.x_est.allFinite() && last.P.allFinite() && last.x_true.allFinite();
      const json s = run_summary(sim);
      std::cout << (finite ? "PASS " : "FAIL ") << std::left << std::setw(34) << p.filename().string()
                << " nodes=" << std::setw(6) << sim.history().size() << " estimator=" << std::setw(4)
                << sim.estimator().type() << " posRMS=" << std::setw(12) << s["accuracy"]["positionRms"].get<double>()
                << " ANEES/n=" << (s["calibration"].contains("aneesPerDim") ? s["calibration"]["aneesPerDim"].get<double>() : -1.0)
                << "\n";
      if (!finite) ++failures;
    } catch (const std::exception& e) {
      std::cout << "FAIL " << p.filename().string() << ": " << e.what() << "\n";
      ++failures;
    }
  }
  std::cout << count - failures << "/" << count << " scenarios ran to completion with finite results\n";
  return failures == 0 && count > 0 ? 0 : 1;
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc < 2) {
      std::cerr << "usage: osim_cli <scenario.json> [--estimator TYPE] [--csv FILE] [--observability W]\n"
                   "       osim_cli --check-all <dir>\n       osim_cli --list\n";
      return 2;
    }
    const std::string first = argv[1];
    if (first == "--check-all" && argc >= 3) return check_all(argv[2]);
    if (first == "--list") {
      for (const auto& e : EstimatorRegistry::instance().list())
        std::cout << "estimator " << e.type << " — " << e.display_name << ": " << e.summary << "\n";
      for (const auto& [k, v] : SensorRegistry::instance().entries()) std::cout << "sensor    " << k << " — " << v.description << "\n";
      return 0;
    }
    json j = load_json(first);
    std::string csv;
    double obs_window = -1.0;
    for (int i = 2; i + 1 < argc; i += 2) {
      const std::string a = argv[i];
      if (a == "--estimator") j["estimator"]["type"] = argv[i + 1];
      else if (a == "--csv") csv = argv[i + 1];
      else if (a == "--observability") obs_window = std::stod(argv[i + 1]);
      else throw ConfigError("Unknown option " + a);
    }
    Simulation sim = Simulation::from_json(j);
    if (obs_window > 0) {
      const auto rep = local_observability(sim, obs_window);
      std::cout << "observability over " << obs_window << " s: rank " << rep.rank << "/" << rep.state_dim
                << ", condition " << rep.condition << ", rows " << rep.measurements << "\n";
      for (const auto& w : rep.weak_directions) std::cout << "  " << w << "\n";
    }
    sim.run_to_end();
    if (!csv.empty()) write_csv(sim, csv);
    std::cout << run_summary(sim).dump(2) << "\n";
    return 0;
  } catch (const std::exception& e) {
    std::cerr << "error: " << e.what() << "\n";
    return 1;
  }
}
