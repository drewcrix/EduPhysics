#include "osim/simulation/json_util.hpp"

namespace osim::json_util {

Vec get_vec(const json& j, int n, const std::string& what) {
  Vec v(n);
  if (j.is_number()) {
    v.setConstant(j.get<double>());
    return v;
  }
  if (!j.is_array() || static_cast<int>(j.size()) != n)
    throw ConfigError(what + " must be a number or a list of " + std::to_string(n) + " numbers.");
  for (int i = 0; i < n; ++i) v[i] = j.at(i).get<double>();
  return v;
}

Mat get_mat(const json& j, int n, const std::string& what) {
  if (!j.is_array() || static_cast<int>(j.size()) != n)
    throw ConfigError(what + " must be a " + std::to_string(n) + "×" + std::to_string(n) + " matrix (list of rows).");
  Mat M(n, n);
  for (int i = 0; i < n; ++i) {
    const auto& row = j.at(i);
    if (!row.is_array() || static_cast<int>(row.size()) != n)
      throw ConfigError(what + ": row " + std::to_string(i + 1) + " must have " + std::to_string(n) + " entries.");
    for (int k = 0; k < n; ++k) M(i, k) = row.at(k).get<double>();
  }
  return M;
}

json to_json(const Vec& v) {
  json a = json::array();
  for (int i = 0; i < v.size(); ++i) a.push_back(v[i]);
  return a;
}

json to_json(const Mat& m) {
  json a = json::array();
  for (int i = 0; i < m.rows(); ++i) {
    json row = json::array();
    for (int k = 0; k < m.cols(); ++k) row.push_back(m(i, k));
    a.push_back(row);
  }
  return a;
}

bool read_covariance(const json& j, const std::string& prefix, int n, const std::string& what, Mat& out) {
  const std::string ks = prefix + "Sigma", kc = prefix + "Covariance";
  if (j.contains(kc)) {
    out = get_mat(j.at(kc), n, what);
    return true;
  }
  if (j.contains(ks)) {
    out = get_vec(j.at(ks), n, what).cwiseAbs2().asDiagonal();
    return true;
  }
  return false;
}

}  // namespace osim::json_util
