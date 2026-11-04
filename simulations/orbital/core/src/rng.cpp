#include "osim/rng.hpp"

#include "osim/constants.hpp"

#include <cmath>

namespace osim {

namespace {

std::uint64_t splitmix64(std::uint64_t& state) {
  std::uint64_t z = (state += 0x9E3779B97F4A7C15ULL);
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
  z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
  return z ^ (z >> 31);
}

std::uint64_t rotl(std::uint64_t x, int k) { return (x << k) | (x >> (64 - k)); }

}  // namespace

double wrap_angle(double a) {
  // Wrap to (-pi, pi] using fmod so that very large angles are handled exactly
  double w = std::fmod(a + constants::PI, constants::TWO_PI);
  if (w <= 0.0) w += constants::TWO_PI;
  return w - constants::PI;
}

Rng::Rng(std::uint64_t seed) {
  std::uint64_t st = seed;
  for (auto& s : s_) s = splitmix64(st);
}

Rng::Rng(std::uint64_t seed, std::string_view stream, std::uint64_t counter) {
  // Mix the three keys through SplitMix64 so that neighbouring counters are uncorrelated
  std::uint64_t st = seed;
  std::uint64_t a = splitmix64(st) ^ hash_name(stream);
  st = a;
  std::uint64_t b = splitmix64(st) ^ (counter * 0xD1B54A32D192ED03ULL);
  st = b;
  for (auto& s : s_) s = splitmix64(st);
}

std::uint64_t Rng::hash_name(std::string_view s) {
  std::uint64_t h = 0xcbf29ce484222325ULL;
  for (unsigned char c : s) {
    h ^= c;
    h *= 0x100000001b3ULL;
  }
  return h;
}

std::uint64_t Rng::next_u64() {
  // xoshiro256** 1.0 (Blackman & Vigna, public domain reference algorithm)
  const std::uint64_t result = rotl(s_[1] * 5, 7) * 9;
  const std::uint64_t t = s_[1] << 17;
  s_[2] ^= s_[0];
  s_[3] ^= s_[1];
  s_[1] ^= s_[2];
  s_[0] ^= s_[3];
  s_[2] ^= t;
  s_[3] = rotl(s_[3], 45);
  return result;
}

double Rng::uniform() {
  // 53 random mantissa bits, shifted by half a step so 0 and 1 are never returned
  return (static_cast<double>(next_u64() >> 11) + 0.5) * 0x1.0p-53;
}

double Rng::normal() {
  if (has_spare_) {
    has_spare_ = false;
    return spare_;
  }
  // Box–Muller transform
  const double u1 = uniform();
  const double u2 = uniform();
  const double r = std::sqrt(-2.0 * std::log(u1));
  const double a = constants::TWO_PI * u2;
  spare_ = r * std::sin(a);
  has_spare_ = true;
  return r * std::cos(a);
}

Vec Rng::normal_vector(int n) {
  Vec v(n);
  for (int i = 0; i < n; ++i) v[i] = normal();
  return v;
}

Vec Rng::gaussian(const Mat& L) { return L * normal_vector(static_cast<int>(L.cols())); }

}  // namespace osim
