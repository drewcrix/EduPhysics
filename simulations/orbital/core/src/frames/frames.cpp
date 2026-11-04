#include "osim/frames/frames.hpp"

#include "osim/constants.hpp"

#include <algorithm>
#include <cmath>

namespace osim::frames {

Mat3 rot_z(double a) {
  const double c = std::cos(a), s = std::sin(a);
  Mat3 R;
  R << c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0;
  return R;
}

double greenwich_angle(double t, double theta_g0) { return theta_g0 + constants::OMEGA_EARTH * t; }

Mat3 eci_to_ecef(double t, double theta_g0) { return rot_z(-greenwich_angle(t, theta_g0)); }

Vec3 geodetic_to_ecef(double lat, double lon, double alt) {
  const double rho = constants::R_EARTH + alt;
  return rho * Vec3(std::cos(lat) * std::cos(lon), std::cos(lat) * std::sin(lon), std::sin(lat));
}

Vec3 ecef_to_geodetic(const Vec3& r) {
  const double rn = r.norm();
  return {std::asin(std::clamp(r.z() / rn, -1.0, 1.0)), std::atan2(r.y(), r.x()), rn - constants::R_EARTH};
}

Mat3 enu_basis_ecef(double lat, double lon) {
  const double sl = std::sin(lat), cl = std::cos(lat), so = std::sin(lon), co = std::cos(lon);
  Mat3 M;
  M << -so, co, 0.0,             // East
       -sl * co, -sl * so, cl,   // North
       cl * co, cl * so, sl;     // Up
  return M;
}

Mat3 rtn_basis(const Vec3& r, const Vec3& v) {
  const Vec3 R = r.normalized();
  const Vec3 N = r.cross(v).normalized();
  const Vec3 T = N.cross(R);
  Mat3 M;
  M.row(0) = R.transpose();
  M.row(1) = T.transpose();
  M.row(2) = N.transpose();
  return M;
}

Vec keplerian_to_cartesian(const KeplerianElements& k, double mu) {
  if (!(k.a > 0.0) || k.e < 0.0 || k.e >= 1.0)
    throw ConfigError("Keplerian elements must describe an ellipse (a > 0, 0 ≤ e < 1).");
  const double p = k.a * (1.0 - k.e * k.e);  // semi-latus rectum
  const double r = p / (1.0 + k.e * std::cos(k.nu));
  // Perifocal position and velocity
  const Vec3 r_pf(r * std::cos(k.nu), r * std::sin(k.nu), 0.0);
  const Vec3 v_pf(-std::sqrt(mu / p) * std::sin(k.nu), std::sqrt(mu / p) * (k.e + std::cos(k.nu)), 0.0);
  // Perifocal to ECI: R3(-raan) R1(-i) R3(-argp)
  const Mat3 Q = rot_z(k.raan) * Eigen::AngleAxisd(k.i, Vec3::UnitX()).toRotationMatrix() * rot_z(k.argp);
  Vec x(6);
  x.head<3>() = Q * r_pf;
  x.tail<3>() = Q * v_pf;
  return x;
}

KeplerianElements cartesian_to_keplerian(const Vec& x, double mu) {
  const Vec3 r = x.head<3>(), v = x.tail<3>();
  const Vec3 h = r.cross(v);
  const Vec3 nvec = Vec3::UnitZ().cross(h);
  const Vec3 evec = v.cross(h) / mu - r.normalized();
  KeplerianElements k;
  k.e = evec.norm();
  k.a = 1.0 / (2.0 / r.norm() - v.squaredNorm() / mu);
  k.i = std::acos(std::clamp(h.z() / h.norm(), -1.0, 1.0));
  const double nn = nvec.norm();
  k.raan = nn > 1e-12 ? std::atan2(nvec.y(), nvec.x()) : 0.0;
  if (k.e > 1e-10 && nn > 1e-12) {
    k.argp = std::acos(std::clamp(nvec.dot(evec) / (nn * k.e), -1.0, 1.0));
    if (evec.z() < 0) k.argp = constants::TWO_PI - k.argp;
    k.nu = std::acos(std::clamp(evec.dot(r) / (k.e * r.norm()), -1.0, 1.0));
    if (r.dot(v) < 0) k.nu = constants::TWO_PI - k.nu;
  } else {
    // Circular (or equatorial): measure the argument of latitude from the node instead
    k.argp = 0.0;
    const Vec3 ref = nn > 1e-12 ? Vec3(nvec / nn) : Vec3::UnitX();
    k.nu = std::atan2(ref.cross(r).dot(h.normalized()), ref.dot(r));
    if (k.nu < 0) k.nu += constants::TWO_PI;
  }
  return k;
}

double specific_energy(const Vec& x, double mu) {
  return 0.5 * x.segment<3>(3).squaredNorm() - mu / x.head<3>().norm();
}

Vec3 angular_momentum(const Vec& x) { return Vec3(x.head<3>()).cross(Vec3(x.segment<3>(3))); }

double orbital_period(double a, double mu) { return constants::TWO_PI * std::sqrt(a * a * a / mu); }

}  // namespace osim::frames
