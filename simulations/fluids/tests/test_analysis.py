import numpy as np
import pytest

from eduphysics_fluids.analysis import classify_flow, unsteady_statistics, wall_critical_points


def synthetic_surface(theta_stag=np.pi + 0.08, bubble=(0.3, 0.6), n=800):
    """Airfoil-like wall shear: attached everywhere, front stagnation on the lower surface and a
    separation bubble on the rear upper surface (reversed flow -> positive CCW shear there)."""
    theta = np.linspace(0.0, 2.0 * np.pi, n + 1)[:-1]
    tau = np.where(theta < theta_stag, -1.0, 1.0) * np.minimum(1.0, 20 * np.abs(theta - theta_stag))
    in_bubble = (theta > bubble[0]) & (theta < bubble[1])
    tau[in_bubble] = 0.2
    x, y = 0.5 * (1 + np.cos(theta)), 0.06 * np.sin(theta)
    arc = np.r_[0.0, np.cumsum(np.hypot(np.diff(x), np.diff(y)))]
    cp = np.exp(-200 * (theta - theta_stag) ** 2)
    return {"theta": theta, "x": x, "y": y, "station": x, "upper": theta <= np.pi, "cp": cp,
            "cf": tau, "tau_ccw": tau, "arc": arc}


def test_wall_critical_points_classification():
    points = wall_critical_points(synthetic_surface())
    kinds = sorted(p["kind"] for p in points)
    assert kinds == ["reattachment", "separation", "stagnation", "trailing_edge"]
    by_kind = {p["kind"]: p for p in points}
    assert by_kind["stagnation"]["upper"] is False                     # lower surface at positive alpha
    assert by_kind["stagnation"]["station"] == pytest.approx(0.5 * (1 + np.cos(np.pi + 0.08)), abs=2e-3)
    assert by_kind["separation"]["station"] == pytest.approx(0.5 * (1 + np.cos(0.6)), abs=2e-3)
    assert by_kind["reattachment"]["station"] > by_kind["separation"]["station"]


def test_short_noise_runs_are_ignored():
    s = synthetic_surface(bubble=(0.3, 0.3015))                       # sub-threshold flicker
    kinds = sorted(p["kind"] for p in wall_critical_points(s))
    assert kinds == ["stagnation", "trailing_edge"]


def history(t, cl, cd=None):
    cd = np.full_like(t, 0.2) if cd is None else cd
    return np.c_[t, cl, cd, np.zeros_like(t)]


def test_strouhal_of_periodic_signal():
    t = np.arange(0.0, 32.0, 0.05)
    h = history(t, 0.5 + 0.1 * np.sin(2 * np.pi * 0.43 * t), 0.2 + 0.01 * np.sin(4 * np.pi * 0.43 * t))
    stats = unsteady_statistics(h, 20.0)
    assert stats["strouhal"] == pytest.approx(0.43, abs=0.01)
    assert stats["periodic"]
    assert stats["cl"]["mean"] == pytest.approx(0.5, abs=0.01)
    assert classify_flow(False, stats) == "periodic"


def test_flow_classes():
    t = np.arange(0.0, 32.0, 0.05)
    rng = np.random.default_rng(3)
    assert classify_flow(True, None) == "steady"
    assert classify_flow(False, unsteady_statistics(history(t, 0.3 + 1e-5 * np.sin(t)), 20.0)) == "nearly_steady"
    assert classify_flow(False, unsteady_statistics(history(t, 0.3 + 0.004 * t), 20.0)) == "not_converged"
    noisy = 0.3 + 0.05 * np.convolve(rng.standard_normal(t.size), np.ones(5) / 5, "same")
    assert classify_flow(False, unsteady_statistics(history(t, noisy), 20.0)) == "irregular"
