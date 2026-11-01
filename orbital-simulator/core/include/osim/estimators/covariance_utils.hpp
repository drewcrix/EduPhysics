#pragma once
/**
 * Covariance helpers shared by sensors, estimators and the scenario validator.
 */

#include "osim/types.hpp"

#include <string>
#include <vector>

namespace osim::cov {

/// (M + Mᵀ)/2 — numerically help a covariance matrix stay symmetric.
Mat symmetrize(const Mat& M);

/// Smallest eigenvalue of the symmetric part of M.
double min_eigenvalue(const Mat& M);

struct Check {
  bool ok = true;
  std::string message;  // student-facing explanation when !ok
};

/**
 * Validate a user-supplied covariance: dimension, finiteness, symmetry (relative
 * tolerance 1e-9) and positive (semi)definiteness. `what` names the matrix and `units`
 * lists the unit of each diagonal entry, both used in the message.
 */
Check validate(const Mat& M, int expected_dim, const std::string& what, bool require_pd,
               const std::vector<std::string>& units = {});

/// Clip eigenvalues below `floor` (absolute) so the matrix is symmetric PSD. Sets *repaired.
Mat psd_repair(const Mat& M, double floor, bool* repaired = nullptr);

/// Lower Cholesky factor with progressive diagonal jitter if the matrix is not quite PD.
Mat safe_cholesky(const Mat& P, bool* jittered = nullptr);

/// Joseph-form update (I − K H) P (I − K H)ᵀ + K R Kᵀ — stays PSD with any gain K.
Mat joseph_update(const Mat& P, const Mat& K, const Mat& H, const Mat& R);

/// Diagonal covariance from standard deviations.
Mat from_sigmas(const std::vector<double>& sigma);
Mat from_sigmas(const Vec& sigma);

}  // namespace osim::cov
