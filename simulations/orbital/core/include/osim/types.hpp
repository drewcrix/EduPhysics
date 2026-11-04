#pragma once
/**
 * Common linear-algebra types and small value types used across the simulator.
 *
 * Everything is double precision and SI units (m, s, kg, rad, N, N·m). Units are only
 * converted for presentation in the user interface.
 */

#include <Eigen/Dense>

#include <stdexcept>
#include <string>
#include <vector>

namespace osim {

using Vec = Eigen::VectorXd;
using Mat = Eigen::MatrixXd;
using Vec3 = Eigen::Vector3d;
using Mat3 = Eigen::Matrix3d;

/// What a state or measurement component physically is. Used for angle wrapping,
/// plot units and the scaling of the observability diagnostic.
enum class Quantity { Position, Velocity, Angle, AngularRate, Range, Other };

/// Label for one component of a state or measurement vector.
struct ComponentLabel {
  std::string name;   // e.g. "x", "φ", "range"
  std::string unit;   // e.g. "m", "m/s", "rad"
  Quantity quantity = Quantity::Other;
  bool is_angle() const { return quantity == Quantity::Angle; }
};

/// Closed time interval [start, end] in seconds since the scenario epoch.
struct Interval {
  double start = 0.0;
  double end = 0.0;
  bool contains(double t) const { return t >= start && t <= end; }
};

/// Raised for invalid scenario, sensor or covariance configurations. The message is
/// written for students and shown verbatim in the interface.
class ConfigError : public std::runtime_error {
 public:
  using std::runtime_error::runtime_error;
};

/// Wrap an angle into (-pi, pi].
double wrap_angle(double a);

/// True if every entry is finite (no NaN or infinity).
inline bool all_finite(const Mat& m) { return m.allFinite(); }

}  // namespace osim
