#include "osim/diagnostics/statistics.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace osim::stats {

namespace {

// Series representation, converges quickly for x < a + 1
double gamma_p_series(double a, double x) {
  double sum = 1.0 / a, term = sum, ap = a;
  for (int n = 0; n < 10000; ++n) {
    ap += 1.0;
    term *= x / ap;
    sum += term;
    if (std::abs(term) < std::abs(sum) * 1e-16) break;
  }
  return sum * std::exp(-x + a * std::log(x) - std::lgamma(a));
}

// Continued fraction (modified Lentz) for Q(a, x) = 1 − P(a, x), for x ≥ a + 1
double gamma_q_cf(double a, double x) {
  const double tiny = 1e-300;
  double b = x + 1.0 - a, c = 1.0 / tiny, d = 1.0 / b, h = d;
  for (int i = 1; i < 10000; ++i) {
    const double an = -i * (i - a);
    b += 2.0;
    d = an * d + b;
    if (std::abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (std::abs(c) < tiny) c = tiny;
    d = 1.0 / d;
    const double del = d * c;
    h *= del;
    if (std::abs(del - 1.0) < 1e-16) break;
  }
  return std::exp(-x + a * std::log(x) - std::lgamma(a)) * h;
}

}  // namespace

double gamma_p(double a, double x) {
  if (x <= 0.0) return 0.0;
  if (x < a + 1.0) return gamma_p_series(a, x);
  return 1.0 - gamma_q_cf(a, x);
}

double chi2_cdf(double x, double k) { return gamma_p(0.5 * k, 0.5 * x); }

double chi2_quantile(double p, double k) {
  if (!(p > 0.0 && p < 1.0) || !(k > 0.0)) throw std::domain_error("chi2_quantile needs 0 < p < 1 and k > 0.");
  // Bracket the root, then bisect: robust for every p and k used here
  double lo = 0.0, hi = std::max(1.0, k);
  while (chi2_cdf(hi, k) < p) hi *= 2.0;
  for (int i = 0; i < 200; ++i) {
    const double mid = 0.5 * (lo + hi);
    if (chi2_cdf(mid, k) < p)
      lo = mid;
    else
      hi = mid;
    if (hi - lo < 1e-12 * std::max(1.0, hi)) break;
  }
  return 0.5 * (lo + hi);
}

Interval2 average_chi2_bounds(double k, long long N, double confidence) {
  if (N <= 0) return {0.0, 0.0};
  const double a = 0.5 * (1.0 - confidence);
  const double dof = k * static_cast<double>(N);
  return {chi2_quantile(a, dof) / static_cast<double>(N), chi2_quantile(1.0 - a, dof) / static_cast<double>(N)};
}

}  // namespace osim::stats
