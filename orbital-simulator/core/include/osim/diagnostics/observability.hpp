#pragma once
/**
 * Local, linearised observability over a time window.
 *
 * Along the *estimated* trajectory (never truth) from t₀ to t₀ + W, every planned
 * measurement i contributes the block row  R_i^{-1/2} H_i Φ(t_i, t₀) S, where S scales
 * each state by a characteristic size (1 km, 1 m/s, 0.01 rad, 10⁻⁴ rad/s) so that singular
 * values are comparable across units. From the SVD of the stacked matrix O:
 *
 *   rank        number of singular values above 10⁻⁹ σ_max (numerical rank)
 *   condition   σ_max / σ_min over the observable subspace
 *   null space  directions no measurement in the window can see
 *   best σ      sqrt(diag((Oᵀ O)⁺)) — the information-only (Cramér–Rao-style) bound
 *               without prior or process noise
 *
 * This is a *local* test: it says whether small deviations near this trajectory can be
 * distinguished with these sensors, in this window, to first order. It is not a global
 * guarantee and it ignores noise statistics beyond R.
 */

#include "osim/simulation/simulation.hpp"

namespace osim {

struct ObservabilityReport {
  double t0 = 0.0, window = 0.0;
  int state_dim = 0;
  int measurements = 0;     // scalar measurement rows used
  int rank = 0;
  double condition = 0.0;   // ∞ when rank-deficient (reported over the observable part)
  Vec singular_values;
  Vec best_sigma;           // per state, in state units; +∞ for unobservable components
  std::vector<bool> unobservable;
  std::vector<std::string> weak_directions;  // human-readable descriptions
  std::vector<std::string> notes;
};

/// Analyse the window [t0, t0 + window] starting from estimate x0 for the given sensors.
ObservabilityReport local_observability(const DynamicsModel& model, const IntegratorConfig& integ, double t0,
                                        const Vec& x0, double window, const std::vector<const Sensor*>& sensors,
                                        const ControlModel* controls);

/// Convenience: analyse the simulation's current estimate with its enabled sensors.
ObservabilityReport local_observability(const Simulation& sim, double window);

/// Characteristic scale used to non-dimensionalise a state component.
double characteristic_scale(Quantity q);

}  // namespace osim
