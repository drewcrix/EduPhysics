#include "osim/sensors/ground_station.hpp"

#include "osim/frames/frames.hpp"

#include <cmath>

namespace osim {

GroundStationSensor::GroundStationSensor(SensorConfig cfg, GroundSite site, Mode mode, double theta_g0)
    : Sensor(std::move(cfg)), site_(std::move(site)), mode_(mode), theta_g0_(theta_g0) {
  check_noise_dims();
  site_ecef_ = frames::geodetic_to_ecef(site_.lat, site_.lon, site_.alt);
}

std::vector<ComponentLabel> GroundStationSensor::labels() const {
  if (mode_ == Mode::RangeOnly) return {{"range", "m", Quantity::Range}};
  return {{"range", "m", Quantity::Range}, {"azimuth", "rad", Quantity::Angle}, {"elevation", "rad", Quantity::Angle}};
}

std::string GroundStationSensor::unsupported_reason(const DynamicsModel& model) const {
  if (!model.is_inertial_orbit())
    return "Ground-station tracking needs the spacecraft's ECI position, but the " + model.name() +
           " model only describes motion relative to a chief spacecraft.";
  return {};
}

Vec3 GroundStationSensor::site_eci(double t) const {
  return frames::rot_z(frames::greenwich_angle(t, theta_g0_)) * site_ecef_;
}

Mat3 GroundStationSensor::enu_from_eci(double t) const {
  return frames::enu_basis_ecef(site_.lat, site_.lon) * frames::eci_to_ecef(t, theta_g0_);
}

Vec3 GroundStationSensor::enu(double t, const Vec3& r) const { return enu_from_eci(t) * (r - site_eci(t)); }

double GroundStationSensor::elevation(double t, const Vec3& r) const {
  const Vec3 l = enu(t, r);
  return std::atan2(l.z(), std::hypot(l.x(), l.y()));
}

bool GroundStationSensor::visible(double t, const Vec& x) const {
  const Vec3 l = enu(t, x.head<3>());
  const double horiz = std::hypot(l.x(), l.y());
  const double el = std::atan2(l.z(), horiz);
  // Reject samples within ~0.06° of zenith, where azimuth is undefined
  return el >= site_.min_elevation && horiz > 1e-3 * l.norm();
}

Vec GroundStationSensor::h(double t, const Vec& x) const {
  const Vec3 l = enu(t, x.head<3>());
  const double rho = l.norm();
  if (mode_ == Mode::RangeOnly) return Vec::Constant(1, rho);
  Vec z(3);
  z << rho, std::atan2(l.x(), l.y()), std::atan2(l.z(), std::hypot(l.x(), l.y()));
  return z;
}

Mat GroundStationSensor::H(double t, const Vec& x) const {
  const Mat3 M = enu_from_eci(t);  // ∂[E N U]/∂r
  const Vec3 l = M * (x.head<3>() - site_eci(t));
  const double E = l.x(), N = l.y(), U = l.z();
  const double rho2 = l.squaredNorm(), rho = std::sqrt(rho2);
  const double hz2 = E * E + N * N, hz = std::sqrt(hz2);

  Mat H = Mat::Zero(dim(), x.size());
  // Range: ∂ρ/∂r = ρ̂ᵀ (in ECI, the ENU rotation is orthogonal)
  H.block(0, 0, 1, 3) = (l / rho).transpose() * M;
  if (mode_ == Mode::RangeOnly) return H;
  // Azimuth A = atan2(E, N)
  const Eigen::RowVector3d dA(N / hz2, -E / hz2, 0.0);
  // Elevation El = atan2(U, hz)
  const Eigen::RowVector3d dEl(-E * U / (rho2 * hz), -N * U / (rho2 * hz), hz / rho2);
  H.block(1, 0, 1, 3) = dA * M;
  H.block(2, 0, 1, 3) = dEl * M;
  return H;
}

}  // namespace osim
