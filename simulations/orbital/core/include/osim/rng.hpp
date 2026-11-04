#pragma once
/**
 * Deterministic, platform-independent random numbers.
 *
 * std::normal_distribution is implementation defined, so the simulator uses its own
 * generator: xoshiro256** seeded through SplitMix64, with Box–Muller normals. Streams are
 * keyed by (seed, stream, counter) so that, for example, the noise on GNSS sample #57 is
 * the same whether or not the star tracker is enabled, and the truth/measurement noise is
 * identical for every estimator in a comparison.
 */

#include "osim/types.hpp"

#include <cstdint>
#include <string_view>

namespace osim {

class Rng {
 public:
  explicit Rng(std::uint64_t seed);
  /// Independent stream for (seed, stream id, counter), e.g. ("gnss", sample index).
  Rng(std::uint64_t seed, std::string_view stream, std::uint64_t counter);

  std::uint64_t next_u64();
  /// Uniform on the open interval (0, 1).
  double uniform();
  /// Standard normal N(0, 1).
  double normal();
  /// Vector of independent standard normals.
  Vec normal_vector(int n);
  /// Sample from N(0, P) using a lower Cholesky factor L of P (P = L Lᵀ).
  Vec gaussian(const Mat& L);

  /// FNV-1a hash of a string; used to turn stream names into integers.
  static std::uint64_t hash_name(std::string_view s);

 private:
  std::uint64_t s_[4];
  bool has_spare_ = false;
  double spare_ = 0.0;
};

}  // namespace osim
