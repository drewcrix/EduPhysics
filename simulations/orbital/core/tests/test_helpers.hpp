#pragma once
// Shared helpers for the native tests.

#include "doctest.h"
#include "osim/constants.hpp"
#include "osim/dynamics/dynamics_model.hpp"
#include "osim/simulation/simulation.hpp"

#include <nlohmann/json.hpp>

#include <fstream>
#include <string>

namespace osim::test {

inline nlohmann::json scenario_json(const std::string& id) {
  std::ifstream f(std::string(OSIM_SCENARIO_DIR) + "/" + id + ".json");
  REQUIRE_MESSAGE(f.good(), "missing scenario " << id);
  nlohmann::json j;
  f >> j;
  return j;
}

/// Central finite-difference Jacobian of g at x with per-component step h_i.
template <typename G>
Mat fd_jacobian(G g, const Vec& x, const Vec& h) {
  const Vec g0 = g(x);
  Mat J(g0.size(), x.size());
  for (int i = 0; i < x.size(); ++i) {
    Vec xp = x, xm = x;
    xp[i] += h[i];
    xm[i] -= h[i];
    J.col(i) = (g(xp) - g(xm)) / (2.0 * h[i]);
  }
  return J;
}

/// Max |A − B| relative to max(|B|, floor).
inline double rel_err(const Mat& A, const Mat& B, double floor = 1e-12) {
  return (A - B).cwiseAbs().maxCoeff() / std::max(floor, B.cwiseAbs().maxCoeff());
}

/// Entry-wise check with a mixed absolute/relative tolerance.
inline bool close(const Mat& A, const Mat& B, double rtol, double atol) {
  for (int i = 0; i < A.rows(); ++i)
    for (int j = 0; j < A.cols(); ++j)
      if (std::abs(A(i, j) - B(i, j)) > atol + rtol * std::abs(B(i, j))) return false;
  return true;
}

}  // namespace osim::test
