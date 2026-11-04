#pragma once
/**
 * Small helpers for reading scenario JSON with student-friendly error messages.
 */

#include "osim/types.hpp"

#include <nlohmann/json.hpp>

#include <string>

namespace osim::json_util {

using json = nlohmann::json;

/// Read a vector of length n; a scalar is broadcast to all n entries.
Vec get_vec(const json& j, int n, const std::string& what);
/// Read a square n×n matrix written as an array of rows.
Mat get_mat(const json& j, int n, const std::string& what);
json to_json(const Vec& v);
json to_json(const Mat& m);

/**
 * Read a covariance from either "<prefix>Sigma" (standard deviations, scalar or list) or
 * "<prefix>Covariance" (full matrix). Returns false when neither key is present.
 */
bool read_covariance(const json& j, const std::string& prefix, int n, const std::string& what, Mat& out);

template <typename T>
T value_or(const json& j, const char* key, T fallback) {
  return j.contains(key) ? j.at(key).get<T>() : fallback;
}

}  // namespace osim::json_util
