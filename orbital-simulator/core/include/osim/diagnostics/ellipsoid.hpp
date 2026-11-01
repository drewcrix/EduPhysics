#pragma once
/**
 * Confidence regions from a covariance sub-matrix.
 *
 * A joint region with probability p for a k-dimensional Gaussian is
 * {d : dᵀ P⁻¹ d ≤ χ²_k(p)}; its semi-axes are sqrt(χ²_k(p) λ_i) along P's eigenvectors.
 * The per-coordinate band ±sqrt(χ²₁(p) P_ii) is a different (marginal) statement.
 */

#include "osim/types.hpp"

namespace osim {

struct Ellipsoid {
  Vec center;
  Vec semi_axes;   // descending
  Mat axes;        // columns are unit principal directions (right-handed for 3-D)
  double confidence = 0.0;
  double k2 = 0.0; // χ²_k(p) scale factor used
};

/// Joint confidence region for a k-dimensional covariance P (k = P.rows()).
Ellipsoid confidence_region(const Vec& center, const Mat& P, double confidence);
/// Half-width of the per-coordinate band with probability p.
double marginal_bound(double variance, double confidence);
/// Probability mass inside a k-D ellipsoid scaled by χ²_j(p) (used to explain the difference).
double mass_inside(double k2, int k);

}  // namespace osim
