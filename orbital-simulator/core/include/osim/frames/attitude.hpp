#pragma once
/**
 * Attitude representations used by the 12-state rigid-body model.
 *
 * Convention (same as the Python reference): ZYX (yaw–pitch–roll) Euler angles
 * e = [φ, θ, ψ] and the body-to-ECI rotation C = R_z(ψ) R_y(θ) R_x(φ). The body x axis
 * (thrust axis) in ECI is therefore C e₁ = [cψ cθ, sψ cθ, −sθ].
 *
 * Euler angles are singular at θ = ±90° (gimbal lock). Quaternion helpers are provided
 * so the model can migrate to a quaternion attitude state (see docs/MATH_AND_UNITS.md).
 */

#include "osim/types.hpp"

#include <Eigen/Geometry>

namespace osim::attitude {

/// Below this |cos θ| the Euler kinematics are treated as singular.
inline constexpr double kGimbalCosMin = 1e-6;
/// Below this |cos θ| (θ within ~2.6° of ±90°) the interface shows a gimbal-lock warning.
inline constexpr double kGimbalCosWarn = 0.045;

Mat3 skew(const Vec3& a);
/// Body-to-ECI direction cosine matrix for ZYX Euler angles [φ, θ, ψ].
Mat3 euler_to_dcm(const Vec3& e);
/// Inverse of euler_to_dcm; returns θ in [−π/2, π/2] and φ, ψ in (−π, π].
Vec3 dcm_to_euler(const Mat3& C);
/// Kinematic matrix W(φ, θ) with ė = W ω_body (rows of the Euler-rate equations in model.py).
Mat3 euler_rate_matrix(const Vec3& e);
/// Rotation matrix exp([δθ×]) for a rotation vector δθ.
Mat3 so3_exp(const Vec3& dtheta);
/// Cosine of pitch clamped away from zero with its sign kept (guardrail for 1/cos θ).
double safe_cos_pitch(double theta);

Eigen::Quaterniond euler_to_quaternion(const Vec3& e);
Vec3 quaternion_to_euler(const Eigen::Quaterniond& q);

}  // namespace osim::attitude
