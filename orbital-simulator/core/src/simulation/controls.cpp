#include "osim/simulation/controls.hpp"

#include "osim/frames/frames.hpp"
#include "osim/rng.hpp"

#include <cmath>

namespace osim {

ControlModel::ControlModel(const ControlSpec& spec, const ModelSpec& truth, const ModelSpec& est, std::uint64_t seed)
    : spec_(spec), kind_(truth.kind), mass_true_(truth.mass), mass_est_(est.mass), seed_(seed) {}

Vec3 ControlModel::to_state_frame(const std::string& frame, const Vec3& d, const Vec& x) const {
  if (kind_ == "cw6" || frame == "ECI" || frame == "LVLH") return d;
  if (frame == "RTN") return frames::rtn_basis(x.head<3>(), x.segment<3>(3)).transpose() * d;
  throw ConfigError("Unknown maneuver frame '" + frame + "' (RTN, ECI or LVLH).");
}

Vec ControlModel::commanded(double t, const Vec& x, double mass) const {
  const int m = kind_ == "rigid12" ? 4 : 3;
  Vec u = Vec::Zero(m);
  for (const auto& s : spec_.segments) {
    if (t < s.start - 1e-9 || t >= s.end - 1e-9) continue;
    if (kind_ == "rigid12") {
      // Thrust along body x and body-axis torques
      u[0] += s.thrust;
      for (int i = 0; i < 3; ++i) u[1 + i] += s.torque[i] + s.torque_amplitude[i] * std::sin(s.torque_omega[i] * t);
    } else {
      u.head<3>() += (s.thrust / mass) * to_state_frame(s.frame, s.direction, x);
    }
  }
  return u;
}

ControlSample ControlModel::sample(double t, const Vec& x_true, long long node) const {
  ControlSample c;
  c.commanded = commanded(t, x_true, mass_true_);
  c.active = c.commanded.cwiseAbs().maxCoeff() > 0.0;
  c.actual = (1.0 + spec_.true_scale_error) * c.commanded;
  c.measured = c.actual;
  if (c.active && spec_.telemetry_sigma_true.cwiseAbs().maxCoeff() > 0.0) {
    Rng rng(seed_, "telemetry", static_cast<std::uint64_t>(node));
    c.measured += spec_.telemetry_sigma_true.cwiseProduct(rng.normal_vector(static_cast<int>(c.actual.size())));
  }
  return c;
}

Vec ControlModel::for_estimator(const ControlSample& c) const {
  return spec_.estimator_knows_thrust ? c.measured : Vec::Zero(c.measured.size());
}

Vec ControlModel::planned(double t, const Vec& x_est) const {
  const Vec u = commanded(t, x_est, mass_est_);
  return spec_.estimator_knows_thrust ? u : Vec::Zero(u.size());
}

Vec3 ControlModel::execute_impulse(const ImpulseEvent& e, const Vec& x_true, long long idx) const {
  Vec3 dv = (1.0 + e.true_magnitude_error) * to_state_frame(e.frame, e.dv, x_true);
  Rng rng(seed_, "impulse", static_cast<std::uint64_t>(idx));
  if (e.true_pointing_error != 0.0 && dv.norm() > 0.0) {
    // Rotate the burn by the pointing error about a random axis perpendicular to it
    Vec3 a = dv.unitOrthogonal();
    const double phi = 2.0 * 3.14159265358979323846 * rng.uniform();
    a = Eigen::AngleAxisd(phi, dv.normalized()) * a;
    dv = Eigen::AngleAxisd(e.true_pointing_error, a) * dv;
  }
  for (int i = 0; i < 3; ++i) dv[i] += e.true_sigma[i] * rng.normal();
  return dv;
}

Vec3 ControlModel::commanded_impulse(const ImpulseEvent& e, const Vec& x_est) const {
  return to_state_frame(e.frame, e.dv, x_est);
}

std::vector<double> ControlModel::boundaries() const {
  std::vector<double> b;
  for (const auto& s : spec_.segments) {
    b.push_back(s.start);
    b.push_back(s.end);
  }
  return b;
}

}  // namespace osim
