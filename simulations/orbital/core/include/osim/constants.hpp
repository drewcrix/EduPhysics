#pragma once
/**
 * Physical constants (SI units). Values match the user's Python reference where one
 * exists so that results can be compared directly.
 */

#include <numbers>

namespace osim::constants {

inline constexpr double PI = std::numbers::pi;
inline constexpr double TWO_PI = 2.0 * std::numbers::pi;
inline constexpr double DEG = std::numbers::pi / 180.0;  // multiply degrees by DEG

inline constexpr double MU_EARTH = 3.986004418e14;  // Earth's gravitational parameter (m³/s²)
inline constexpr double R_EARTH = 6371e3;           // Earth's mean radius, spherical model (m)
inline constexpr double OMEGA_EARTH = 7.2921150e-5; // Earth's sidereal rotation rate (rad/s)

}  // namespace osim::constants
