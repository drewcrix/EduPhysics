#pragma once
/**
 * χ² distribution functions for NEES/NIS consistency tests and confidence regions.
 *
 * Joint vs. per-coordinate confidence: a 99 % region for a k-dimensional Gaussian is the
 * ellipsoid dᵀ P⁻¹ d ≤ χ²_k(0.99). Using χ²₁(0.99) (= 6.63, the per-axis 2.58σ band) for
 * a 3-D ellipsoid would contain far less than 99 % of the probability (about 91 %).
 */

namespace osim::stats {

/// Regularised lower incomplete gamma function P(a, x).
double gamma_p(double a, double x);
/// χ² cumulative distribution with k degrees of freedom.
double chi2_cdf(double x, double k);
/// χ² quantile: the x with chi2_cdf(x, k) = p.
double chi2_quantile(double p, double k);

/// Two-sided acceptance interval for the time-average of N independent χ²_k samples:
/// N·mean ~ χ²_{N k}. Returns [lower, upper] for the *mean*.
struct Interval2 {
  double lower;
  double upper;
};
Interval2 average_chi2_bounds(double k, long long N, double confidence);

}  // namespace osim::stats
