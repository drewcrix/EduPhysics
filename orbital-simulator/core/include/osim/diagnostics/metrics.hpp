#pragma once
/**
 * Run summary: accuracy, uncertainty calibration, tracking-resource cost and compute cost,
 * reported separately so that no single number rewards a filter for claiming a tiny
 * covariance. NEES uses truth and is therefore an *evaluation* quantity only.
 *
 * Calibration verdict uses the ratio ANEES / n (average NEES per state dimension):
 *   < 1/3 under-confident, 1/3 … 3 consistent, > 3 over-confident.
 * The band is wide because one run's NEES values are strongly correlated in time: a
 * consistent filter's single-run ratio varies by about ×3 between seeds.
 * The formal two-sided 95 % bounds of the χ² average are reported too, with the caveat
 * that successive NEES values are correlated, so those bounds are optimistic.
 */

#include "osim/simulation/simulation.hpp"

#include <nlohmann/json.hpp>

namespace osim {

/// Summary of the run so far. `tail_fraction` selects the final part used for
/// "steady-state" accuracy (default: last half of the elapsed time).
nlohmann::json run_summary(const Simulation& sim, double tail_fraction = 0.5);

}  // namespace osim
