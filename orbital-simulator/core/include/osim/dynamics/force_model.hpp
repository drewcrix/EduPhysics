#pragma once
/**
 * Composable translational force models.
 *
 * A force model returns a specific acceleration a(t, r, v) in the ECI frame [m/s²] and its
 * partial derivatives ∂a/∂r and ∂a/∂v, which the EKF, the linearised KF and the
 * observability diagnostic need. Orbital models sum any number of force models, so J2,
 * drag, solar radiation pressure or third-body gravity can be added later without
 * touching estimators or the frontend (see docs/EXTENDING.md).
 */

#include "osim/types.hpp"

#include <memory>
#include <string>

namespace osim {

class ForceModel {
 public:
  virtual ~ForceModel() = default;
  virtual std::string name() const = 0;
  /// Specific acceleration in ECI [m/s²].
  virtual Vec3 acceleration(double t, const Vec3& r, const Vec3& v) const = 0;
  /// Partial derivatives of the acceleration with respect to position and velocity.
  virtual void partials(double t, const Vec3& r, const Vec3& v, Mat3& da_dr,
                        Mat3& da_dv) const = 0;
};

using ForceModelPtr = std::shared_ptr<const ForceModel>;

/// Two-body point-mass gravity a = -μ r / |r|³.
class PointMassGravity final : public ForceModel {
 public:
  explicit PointMassGravity(double mu);
  std::string name() const override { return "point_mass"; }
  Vec3 acceleration(double t, const Vec3& r, const Vec3& v) const override;
  void partials(double t, const Vec3& r, const Vec3& v, Mat3& da_dr, Mat3& da_dv) const override;
  double mu() const { return mu_; }

 private:
  double mu_;
};

}  // namespace osim
