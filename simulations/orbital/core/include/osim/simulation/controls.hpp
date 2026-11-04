#pragma once
/**
 * Commanded, actual and measured controls are kept separate:
 *
 *   commanded  u_c : what the operator scheduled (thrust arcs, impulsive burns)
 *   actual     u_a : what the actuator really delivered, u_a = (1 + e_scale) u_c (truth only)
 *   measured   u_m : telemetry/accelerometer reading, u_m = u_a + v,  v ~ N(0, Σ_true)
 *
 * The estimator propagates with u_m when it knows about the thrust, otherwise with zero
 * (an unmodelled maneuver). Controls are zero-order-hold: evaluated at the start of each
 * node interval and held constant; segment boundaries are always nodes.
 */

#include "osim/simulation/scenario.hpp"

namespace osim {

struct ControlSample {
  Vec commanded;
  Vec actual;
  Vec measured;
  bool active = false;
};

class ControlModel {
 public:
  ControlModel(const ControlSpec& spec, const ModelSpec& truth, const ModelSpec& est, std::uint64_t seed);

  /// Truth-side control over [t, t_next), using the true state for frame conversions.
  ControlSample sample(double t, const Vec& x_true, long long node) const;
  /// Control the estimator propagates with.
  Vec for_estimator(const ControlSample& c) const;
  /// Control the estimator *plans* with at its own estimate (observability look-ahead).
  Vec planned(double t, const Vec& x_est) const;

  /// Truth-side executed Δv (in the state's velocity frame) for impulse number idx.
  Vec3 execute_impulse(const ImpulseEvent& e, const Vec& x_true, long long idx) const;
  /// Commanded Δv as the estimator computes it from its own estimate.
  Vec3 commanded_impulse(const ImpulseEvent& e, const Vec& x_est) const;

  /// Times at which the control changes (segment starts and ends).
  std::vector<double> boundaries() const;

  ControlSpec& spec() { return spec_; }
  const ControlSpec& spec() const { return spec_; }

 private:
  Vec commanded(double t, const Vec& x, double mass) const;
  Vec3 to_state_frame(const std::string& frame, const Vec3& d, const Vec& x) const;
  ControlSpec spec_;
  std::string kind_;
  double mass_true_, mass_est_;
  std::uint64_t seed_;
};

}  // namespace osim
