#include "osim/diagnostics/ellipsoid.hpp"

#include "osim/diagnostics/statistics.hpp"
#include "osim/estimators/covariance_utils.hpp"

#include <Eigen/Eigenvalues>

#include <cmath>

namespace osim {

Ellipsoid confidence_region(const Vec& center, const Mat& P, double confidence) {
  const int k = static_cast<int>(P.rows());
  Ellipsoid e;
  e.center = center;
  e.confidence = confidence;
  e.k2 = stats::chi2_quantile(confidence, k);
  // Compute eigenvalues and eigenvectors to find axes for the covariance ellipsoid
  Eigen::SelfAdjointEigenSolver<Mat> es(cov::symmetrize(P));
  const Vec l = es.eigenvalues().cwiseMax(0.0);
  e.semi_axes.resize(k);
  e.axes.resize(k, k);
  for (int i = 0; i < k; ++i) {  // eigenvalues are ascending; report descending
    e.semi_axes[i] = std::sqrt(e.k2 * l[k - 1 - i]);
    e.axes.col(i) = es.eigenvectors().col(k - 1 - i);
  }
  if (k == 3 && e.axes.determinant() < 0) e.axes.col(2) *= -1.0;
  return e;
}

double marginal_bound(double variance, double confidence) {
  return std::sqrt(stats::chi2_quantile(confidence, 1) * std::max(0.0, variance));
}

double mass_inside(double k2, int k) { return stats::chi2_cdf(k2, k); }

}  // namespace osim
