"""Aerodynamic post-processing of a solved flow: forces, surface distributions, critical points on the
wall, and statistics of unsteady force histories.

Conventions (free stream U_inf along +x, kinematic pressure, reference length c):
  C_L = F_y / (1/2 U^2 c),  C_D = F_x / (1/2 U^2 c),  C_m = M / (1/2 U^2 c^2), positive nose up,
  C_p = (p - p_inf) / (1/2 U^2),  C_f = tau_w / (1/2 U^2), positive where the near-wall flow moves from
  the leading edge towards the trailing edge (negative values mark reversed, separated flow).
"""
from __future__ import annotations

import numpy as np


def force_breakdown(solver, state):
    """Pressure and viscous contributions to the force and moment, as coefficients."""
    pr = solver.probe
    p_wall, tau_wall, tx, ty = solver.surface_distribution(state)
    ds = pr["length"]
    dfx_p, dfy_p = -p_wall * pr["nx"] * ds, -p_wall * pr["ny"] * ds
    dfx_v, dfy_v = tau_wall * tx * ds, tau_wall * ty * ds
    xr, yr = solver.body.moment_reference()
    arm_x, arm_y = pr["x"] - xr, pr["y"] - yr
    moment = np.sum(arm_x * (dfy_p + dfy_v) - arm_y * (dfx_p + dfx_v))   # counter clockwise positive
    q = 0.5 * solver.u_inf**2 * solver.chord
    return {"cl_pressure": float(dfy_p.sum() / q), "cl_friction": float(dfy_v.sum() / q),
            "cd_pressure": float(dfx_p.sum() / q), "cd_friction": float(dfx_v.sum() / q),
            "cm": float(-moment / (q * solver.chord))}                    # nose up = clockwise


def force_coefficients(solver, state):
    """(C_L, C_D, C_m) from the surface integral of pressure and viscous shear."""
    f = force_breakdown(solver, state)
    return f["cl_pressure"] + f["cl_friction"], f["cd_pressure"] + f["cd_friction"], f["cm"]


def surface_data(solver, state):
    """Surface distributions at the probe stations, ordered counter clockwise from the trailing edge."""
    pr, body = solver.probe, solver.body
    p_wall, tau_wall, _, _ = solver.surface_distribution(state)
    theta = pr["theta"]
    upper = body.is_upper(theta)
    towards_te = np.where(upper, -1.0, 1.0)              # the CCW tangent runs TE -> LE on the upper side
    q = 0.5 * solver.u_inf**2
    arc = np.r_[0.0, np.cumsum(np.hypot(np.diff(pr["x"]), np.diff(pr["y"])))]
    return {"theta": theta, "x": pr["x"], "y": pr["y"], "station": body.surface_station(theta),
            "upper": upper, "cp": p_wall / q, "cf": tau_wall * towards_te / q,
            "tau_ccw": tau_wall, "arc": arc / solver.chord}


def wall_critical_points(surface, min_run=0.004, trailing_edge_zone=0.01):
    """Zeros of the wall shear stress around the surface.

    Walking counter clockwise, a zero where the CCW shear goes - -> + is a point the near-wall flow
    leaves in both directions (attachment or reattachment); + -> - is where it converges (separation).
    Sign runs shorter than `min_run` (arc length / c) are noise and are merged into their neighbours.
    The divergence point nearest the maximum C_p is the front stagnation (attachment) point."""
    tau, arc, cp = surface["tau_ccw"], surface["arc"], surface["cp"]
    n, total = tau.size, arc[-1] + np.hypot(surface["x"][0] - surface["x"][-1], surface["y"][0] - surface["y"][-1])
    sign = np.where(tau >= 0.0, 1, -1)
    ds = np.diff(np.r_[arc, total])

    # Merge short runs (cyclic) until every run is longer than min_run
    for _ in range(50):
        change = np.nonzero(sign != np.roll(sign, 1))[0]
        if change.size < 2:
            break
        lengths = [ds[np.arange(a, b if b > a else b + n) % n].sum() for a, b in zip(change, np.roll(change, -1))]
        k = int(np.argmin(lengths))
        if lengths[k] >= min_run:
            break
        a, b = change[k], change[(k + 1) % change.size]
        sign[np.arange(a, b if b > a else b + n) % n] *= -1

    points = []
    for k in np.nonzero(sign != np.roll(sign, 1))[0]:
        a, b = (k - 1) % n, k                            # zero between stations a and b
        w = tau[a] / (tau[a] - tau[b]) if tau[a] != tau[b] else 0.5
        w = float(np.clip(w, 0.0, 1.0))
        x = surface["x"][a] + w * (surface["x"][b] - surface["x"][a])
        y = surface["y"][a] + w * (surface["y"][b] - surface["y"][a])
        station = surface["station"][a] + w * (surface["station"][b] - surface["station"][a])
        kind = "attachment" if sign[b] > 0 else "separation"
        points.append({"kind": kind, "x": float(x), "y": float(y), "station": float(station),
                       "upper": bool(surface["upper"][b]), "index": int(b),
                       "arc": float((arc[a] + w * ds[a]) % total)})

    # The front stagnation point: the divergence point nearest the pressure maximum
    attach = [p for p in points if p["kind"] == "attachment"]
    if attach:
        k_max = int(np.argmax(cp))
        def distance(p):
            d = abs(p["arc"] - arc[k_max])
            return min(d, total - d)
        front = min(attach, key=distance)
        front["kind"] = "stagnation"
        for p in attach:
            if p is not front:
                p["kind"] = "reattachment"
    # A convergence point at the sharp trailing edge is where the flow leaves the body, not separation
    for p in points:
        if p["kind"] == "separation" and min(p["arc"], total - p["arc"]) < trailing_edge_zone:
            p["kind"] = "trailing_edge"
    for p in points:
        p.pop("index"), p.pop("arc")
    return points


def unsteady_statistics(history, window_start, chord=1.0, u_inf=1.0):
    """Mean, extremes, RMS and dominant frequency of the force history over t >= window_start.

    The Strouhal number St = f c / U_inf comes from the peak of the Hann-windowed spectrum of C_L,
    resampled uniformly. `periodic` is True when that peak carries most of the fluctuation energy."""
    t, cl, cd = history[:, 0], history[:, 1], history[:, 2]
    sel = t >= window_start
    tw, sw = t[sel], cl[sel]
    stats = {}
    for name, series in (("cl", cl[sel]), ("cd", cd[sel])):
        trend = np.polyfit(tw - tw[0], series, 1) if series.size > 2 else np.zeros(2)
        detrended = series - np.polyval(trend, tw - tw[0])
        stats[name] = {"mean": float(series.mean()), "min": float(series.min()), "max": float(series.max()),
                       "rms": float(series.std()), "trend": float(trend[0]),
                       "detrended_range": float(detrended.max() - detrended.min())}
    duration = tw[-1] - tw[0]
    stats["duration"] = float(duration)
    stats["strouhal"], stats["periodic"] = None, False
    if sw.size > 32 and stats["cl"]["detrended_range"] > 1e-5:
        uniform = np.linspace(tw[0], tw[-1], sw.size)
        signal = np.interp(uniform, tw, sw)
        signal = signal - np.polyval(np.polyfit(uniform, signal, 1), uniform)   # a drift is not an oscillation
        signal = signal * np.hanning(signal.size)
        power = np.abs(np.fft.rfft(signal))**2
        freq = np.fft.rfftfreq(signal.size, uniform[1] - uniform[0])
        usable = freq >= 2.0 / duration                  # at least two cycles inside the window
        if usable.any():
            k = np.nonzero(usable)[0][np.argmax(power[usable])]
            # energy within +-2 bins of the peak (Hann leakage) relative to all usable bins
            share = power[max(k - 2, 0):k + 3].sum() / power[usable].sum()
            f_peak = freq[k]
            if 0 < k < power.size - 1:                   # parabolic interpolation of the log spectrum
                a, b, c = np.log(power[k - 1:k + 2] + 1e-300)
                f_peak += 0.5 * (a - c) / (a - 2 * b + c) * (freq[1] - freq[0]) if a - 2 * b + c < 0 else 0.0
            stats["strouhal"] = float(f_peak * chord / u_inf)
            stats["periodic"] = bool(share > 0.5)
            stats["peak_energy_share"] = float(share)
    return stats


def classify_flow(steady, stats, settled=1e-3):
    """Label a run honestly.

    steady         converged by the residual criterion before t_end
    nearly_steady  not converged by that criterion, but C_L and C_D varied by less than `settled` over
                   the averaging window (plotting-precision steady)
    periodic       vortex shedding: one spectral peak carries most of the C_L fluctuation
    irregular      unsteady without a dominant frequency
    not_converged  still drifting (the trend dominates the fluctuation): more simulated time is needed
    """
    if steady:
        return "steady"
    cl, cd = stats["cl"], stats["cd"]
    if max(cl["max"] - cl["min"], cd["max"] - cd["min"]) < settled:
        return "nearly_steady"
    if stats["periodic"]:
        return "periodic"
    drift = abs(cl["trend"]) * stats["duration"]
    return "not_converged" if drift > cl["detrended_range"] else "irregular"
