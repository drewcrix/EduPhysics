#include "osim/estimators/covariance_utils.hpp"

#include <Eigen/Eigenvalues>

#include <cmath>
#include <sstream>

namespace osim::cov {

Mat symmetrize(const Mat& M) { return 0.5 * (M + M.transpose()); }

double min_eigenvalue(const Mat& M) {
  if (M.size() == 0) return 0.0;
  Eigen::SelfAdjointEigenSolver<Mat> es(symmetrize(M), Eigen::EigenvaluesOnly);
  return es.eigenvalues().minCoeff();
}

Check validate(const Mat& M, int n, const std::string& what, bool require_pd,
               const std::vector<std::string>& units) {
  std::ostringstream msg;
  if (M.rows() != n || M.cols() != n) {
    msg << what << " must be " << n << "×" << n << " but is " << M.rows() << "×" << M.cols() << ".";
    return {false, msg.str()};
  }
  if (!M.allFinite()) return {false, what + " contains NaN or infinite entries."};
  const double scale = std::max(1e-300, M.cwiseAbs().maxCoeff());
  for (int i = 0; i < n; ++i)
    for (int j = i + 1; j < n; ++j)
      if (std::abs(M(i, j) - M(j, i)) > 1e-9 * scale) {
        msg << what << " is not symmetric: entry (" << i + 1 << "," << j + 1 << ") = " << M(i, j)
            << " but (" << j + 1 << "," << i + 1 << ") = " << M(j, i)
            << ". A covariance satisfies P = Pᵀ because cov(a,b) = cov(b,a).";
        return {false, msg.str()};
      }
  for (int i = 0; i < n; ++i)
    if (M(i, i) < 0.0 || (require_pd && M(i, i) == 0.0)) {
      msg << what << " has diagonal entry " << i + 1 << " = " << M(i, i);
      if (i < static_cast<int>(units.size())) msg << " " << units[i];
      msg << ". Variances must be " << (require_pd ? "strictly positive" : "non-negative") << ".";
      return {false, msg.str()};
    }
  const double lmin = min_eigenvalue(M);
  const double tol = 1e-12 * scale;
  if (lmin < -tol || (require_pd && lmin <= tol)) {
    msg << what << " is not positive " << (require_pd ? "definite" : "semidefinite")
        << " (smallest eigenvalue " << lmin
        << "). Off-diagonal entries imply a correlation |ρ| > 1 somewhere; reduce them so that "
           "|P_ij| ≤ sqrt(P_ii P_jj) and the matrix stays a valid covariance.";
    return {false, msg.str()};
  }
  return {};
}

Mat psd_repair(const Mat& M, double floor, bool* repaired) {
  Eigen::SelfAdjointEigenSolver<Mat> es(symmetrize(M));
  Vec l = es.eigenvalues();
  bool changed = false;
  for (int i = 0; i < l.size(); ++i)
    if (l[i] < floor) {
      l[i] = floor;
      changed = true;
    }
  if (repaired) *repaired = changed;
  if (!changed) return symmetrize(M);
  return symmetrize(es.eigenvectors() * l.asDiagonal() * es.eigenvectors().transpose());
}

Mat safe_cholesky(const Mat& P, bool* jittered) {
  if (jittered) *jittered = false;
  Mat S = symmetrize(P);
  Eigen::LLT<Mat> llt(S);
  if (llt.info() == Eigen::Success) return llt.matrixL();
  if (jittered) *jittered = true;
  const double scale = std::max(1e-300, S.diagonal().cwiseAbs().maxCoeff());
  for (double eps = 1e-12; eps < 1e-2; eps *= 10.0) {
    Eigen::LLT<Mat> l2(S + eps * scale * Mat::Identity(S.rows(), S.cols()));
    if (l2.info() == Eigen::Success) return l2.matrixL();
  }
  // Last resort: eigenvalue clipping, then factor
  Eigen::LLT<Mat> l3(psd_repair(S, 1e-12 * scale));
  return l3.matrixL();
}

Mat joseph_update(const Mat& P, const Mat& K, const Mat& H, const Mat& R) {
  const Mat IKH = Mat::Identity(P.rows(), P.cols()) - K * H;
  return symmetrize(IKH * P * IKH.transpose() + K * R * K.transpose());
}

Mat from_sigmas(const std::vector<double>& sigma) {
  Vec s(static_cast<int>(sigma.size()));
  for (int i = 0; i < s.size(); ++i) s[i] = sigma[i];
  return from_sigmas(s);
}

Mat from_sigmas(const Vec& sigma) { return sigma.cwiseAbs2().asDiagonal(); }

}  // namespace osim::cov
