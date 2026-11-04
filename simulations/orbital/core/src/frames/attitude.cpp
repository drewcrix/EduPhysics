#include "osim/frames/attitude.hpp"

#include <algorithm>
#include <cmath>

namespace osim::attitude {

Mat3 skew(const Vec3& a) {
  Mat3 S;
  S << 0.0, -a.z(), a.y(), a.z(), 0.0, -a.x(), -a.y(), a.x(), 0.0;
  return S;
}

Mat3 euler_to_dcm(const Vec3& e) {
  const double cph = std::cos(e[0]), sph = std::sin(e[0]);
  const double cth = std::cos(e[1]), sth = std::sin(e[1]);
  const double cps = std::cos(e[2]), sps = std::sin(e[2]);
  Mat3 C;
  // C = Rz(psi) Ry(theta) Rx(phi), body -> inertial
  C << cps * cth, cps * sth * sph - sps * cph, cps * sth * cph + sps * sph,
       sps * cth, sps * sth * sph + cps * cph, sps * sth * cph - cps * sph,
       -sth, cth * sph, cth * cph;
  return C;
}

Vec3 dcm_to_euler(const Mat3& C) {
  const double s = std::clamp(-C(2, 0), -1.0, 1.0);
  const double theta = std::asin(s);
  double phi, psi;
  if (std::abs(std::cos(theta)) > 1e-9) {
    phi = std::atan2(C(2, 1), C(2, 2));
    psi = std::atan2(C(1, 0), C(0, 0));
  } else {
    // Gimbal lock: only phi -/+ psi is defined; put everything into psi
    phi = 0.0;
    psi = std::atan2(-C(0, 1), C(1, 1));
  }
  return {phi, theta, psi};
}

double safe_cos_pitch(double theta) {
  const double c = std::cos(theta);
  if (std::abs(c) >= kGimbalCosMin) return c;
  return c >= 0.0 ? kGimbalCosMin : -kGimbalCosMin;
}

Mat3 euler_rate_matrix(const Vec3& e) {
  const double cph = std::cos(e[0]), sph = std::sin(e[0]);
  const double cth = safe_cos_pitch(e[1]);
  const double tth = std::sin(e[1]) / cth;
  Mat3 W;
  W << 1.0, sph * tth, cph * tth,
       0.0, cph, -sph,
       0.0, sph / cth, cph / cth;
  return W;
}

Mat3 so3_exp(const Vec3& dtheta) {
  const double a = dtheta.norm();
  const Mat3 K = skew(dtheta);
  if (a < 1e-8) return Mat3::Identity() + K + 0.5 * K * K;
  // Rodrigues' formula
  return Mat3::Identity() + std::sin(a) / a * K + (1.0 - std::cos(a)) / (a * a) * K * K;
}

Eigen::Quaterniond euler_to_quaternion(const Vec3& e) {
  return Eigen::Quaterniond(Eigen::AngleAxisd(e[2], Vec3::UnitZ()) *
                            Eigen::AngleAxisd(e[1], Vec3::UnitY()) *
                            Eigen::AngleAxisd(e[0], Vec3::UnitX()));
}

Vec3 quaternion_to_euler(const Eigen::Quaterniond& q) {
  return dcm_to_euler(q.normalized().toRotationMatrix());
}

}  // namespace osim::attitude
