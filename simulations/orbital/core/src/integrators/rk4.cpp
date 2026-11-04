#include "osim/integrators/rk4.hpp"

namespace osim {

Vec rk_four(const DynamicsModel& model, double t, const Vec& x, const Vec& u, double T) {
  const Vec k_1 = model.f(t, x, u);
  const Vec k_2 = model.f(t + T / 2.0, x + T * k_1 / 2.0, u);
  const Vec k_3 = model.f(t + T / 2.0, x + T * k_2 / 2.0, u);
  const Vec k_4 = model.f(t + T, x + T * k_3, u);  // full step for the last stage
  return x + T / 6.0 * (k_1 + 2.0 * k_2 + 2.0 * k_3 + k_4);
}

Vec euler_int(const DynamicsModel& model, double t, const Vec& x, const Vec& u, double T) {
  return x + T * model.f(t, x, u);
}

IntegratorMethod parse_integrator(const std::string& s) {
  if (s == "rk4") return IntegratorMethod::RK4;
  if (s == "euler") return IntegratorMethod::Euler;
  throw ConfigError("Unknown integrator '" + s + "' (use \"rk4\" or \"euler\").");
}

std::string to_string(IntegratorMethod m) { return m == IntegratorMethod::RK4 ? "rk4" : "euler"; }

}  // namespace osim
