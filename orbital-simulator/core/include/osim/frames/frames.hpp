#pragma once
/**
 * Reference frames and orbit-element conversions.
 *
 *   ECI  : Earth-centred inertial; z = Earth spin axis, x fixed at the scenario epoch.
 *   ECEF : Earth-fixed; ECI rotated about z by the Greenwich angle θ_g(t) = θ_g0 + ω_E t
 *          (simple sidereal rotation; precession, nutation and polar motion are neglected).
 *   ENU  : local East–North–Up at a ground station on a spherical Earth.
 *   RTN  : Radial, Transverse (along-track for circular orbits), Normal (orbit normal).
 */

#include "osim/types.hpp"

namespace osim::frames {

/// Rotation about z by angle a: v_rotated = rot_z(a) v.
Mat3 rot_z(double a);
/// Greenwich angle at time t [s] since epoch.
double greenwich_angle(double t, double theta_g0);
/// ECI → ECEF rotation matrix at time t.
Mat3 eci_to_ecef(double t, double theta_g0);

/// Spherical-Earth geodetic (lat, lon, altitude) to ECEF position [m].
Vec3 geodetic_to_ecef(double lat_rad, double lon_rad, double alt_m);
/// ECEF position to spherical latitude, longitude [rad] and altitude [m].
Vec3 ecef_to_geodetic(const Vec3& r_ecef);
/// Rows are the East, North and Up unit vectors expressed in ECEF.
Mat3 enu_basis_ecef(double lat_rad, double lon_rad);

/// Rows are the R, T, N unit vectors expressed in ECI.
Mat3 rtn_basis(const Vec3& r, const Vec3& v);

struct KeplerianElements {
  double a = 0.0;      // semi-major axis (m)
  double e = 0.0;      // eccentricity (-)
  double i = 0.0;      // inclination (rad)
  double raan = 0.0;   // right ascension of the ascending node (rad)
  double argp = 0.0;   // argument of periapsis (rad)
  double nu = 0.0;     // true anomaly (rad)
};

/// Elliptic Keplerian elements to ECI position/velocity [r; v].
Vec keplerian_to_cartesian(const KeplerianElements& k, double mu);
/// ECI position/velocity to elliptic Keplerian elements (e < 1).
KeplerianElements cartesian_to_keplerian(const Vec& x, double mu);

/// Specific mechanical energy v²/2 − μ/r [J/kg].
double specific_energy(const Vec& x, double mu);
/// Specific angular momentum r × v [m²/s].
Vec3 angular_momentum(const Vec& x);
/// Orbital period 2π sqrt(a³/μ) [s].
double orbital_period(double a, double mu);

}  // namespace osim::frames
