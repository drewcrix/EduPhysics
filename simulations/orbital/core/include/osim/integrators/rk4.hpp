#pragma once
/**
 * Fixed-step integrators with a zero-order-hold input (u constant over the step), as in
 * the Python reference integrator.py.
 */

#include "osim/dynamics/dynamics_model.hpp"

namespace osim {

enum class IntegratorMethod { RK4, Euler };

/**
 * Perform fourth-order Runge-Kutta numerical integration.
 *
 * The function to integrate is model.f(t, x, u); we assume a constant input vector u over
 * the time interval T > 0. Global error is O(T⁴).
 */
Vec rk_four(const DynamicsModel& model, double t, const Vec& x, const Vec& u, double T);

/**
 * Perform forward Euler numerical integration (first order, global error O(T)). Kept for
 * the step-size/convergence lesson; not used by default.
 */
Vec euler_int(const DynamicsModel& model, double t, const Vec& x, const Vec& u, double T);

IntegratorMethod parse_integrator(const std::string& s);
std::string to_string(IntegratorMethod m);

}  // namespace osim
