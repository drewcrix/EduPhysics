#include "osim/dynamics/force_model.hpp"

#include <cmath>

namespace osim {

PointMassGravity::PointMassGravity(double mu) : mu_(mu) {
  if (!(mu > 0.0) || !std::isfinite(mu)) throw ConfigError("Gravitational parameter mu must be positive.");
}

Vec3 PointMassGravity::acceleration(double, const Vec3& r, const Vec3&) const {
  const double rn = r.norm();
  if (!(rn > 0.0)) throw std::domain_error("Point-mass gravity evaluated at the centre of the Earth.");
  return -mu_ * r / (rn * rn * rn);
}

void PointMassGravity::partials(double, const Vec3& r, const Vec3&, Mat3& da_dr,
                                Mat3& da_dv) const {
  const double rn = r.norm();
  const double r3 = rn * rn * rn;
  const double r5 = r3 * rn * rn;
  // Gravity-gradient matrix: -mu/r^3 I + 3 mu r r^T / r^5 (same entries as model.py)
  da_dr = -mu_ / r3 * Mat3::Identity() + 3.0 * mu_ * (r * r.transpose()) / r5;
  da_dv.setZero();
}

}  // namespace osim
