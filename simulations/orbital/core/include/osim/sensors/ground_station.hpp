#pragma once
/**
 * Ground-station tracking from a site on a rotating spherical Earth.
 *
 * Geometry at time t (all vectors in ECI):
 *   r_s(t) = R_z(θ_g(t)) r_s,ECEF          station position
 *   ρ      = r − r_s(t)                     line-of-sight vector
 *   [E N U] = M_enu(t) ρ,  M_enu = (ENU basis in ECEF) · R_z(−θ_g(t))
 *
 * Measurements:
 *   range      ρ = |ρ|                      (m)
 *   azimuth    A = atan2(E, N)  (from north, clockwise toward east, rad)
 *   elevation  El = atan2(U, sqrt(E² + N²))  (rad)
 *
 * "range_bearing" returns [ρ, A, El]; "range_only" returns [ρ] as a teaching variant.
 * The site can only track while El ≥ the elevation mask (line of sight above the horizon).
 * Azimuth is singular directly overhead; such samples are rejected (see visible()).
 */

#include "osim/sensors/sensor.hpp"

namespace osim {

struct GroundSite {
  std::string name;
  double lat = 0.0;            // rad
  double lon = 0.0;            // rad
  double alt = 0.0;            // m
  double min_elevation = 0.0;  // rad
};

class GroundStationSensor final : public Sensor {
 public:
  enum class Mode { RangeBearing, RangeOnly };

  GroundStationSensor(SensorConfig cfg, GroundSite site, Mode mode, double theta_g0);

  std::string type() const override { return mode_ == Mode::RangeOnly ? "ground_range" : "ground_station"; }
  int dim() const override { return mode_ == Mode::RangeOnly ? 1 : 3; }
  std::vector<ComponentLabel> labels() const override;
  std::string unsupported_reason(const DynamicsModel& model) const override;
  Vec h(double t, const Vec& x) const override;
  Mat H(double t, const Vec& x) const override;
  bool visible(double t, const Vec& x) const override;

  /// Station position in ECI at time t.
  Vec3 site_eci(double t) const;
  /// Topocentric [E, N, U] of the spacecraft position r.
  Vec3 enu(double t, const Vec3& r) const;
  double elevation(double t, const Vec3& r) const;
  const GroundSite& site() const { return site_; }
  Mode mode() const { return mode_; }

 private:
  Mat3 enu_from_eci(double t) const;
  GroundSite site_;
  Mode mode_;
  double theta_g0_;
  Vec3 site_ecef_;
};

}  // namespace osim
