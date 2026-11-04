import numpy as np
import pytest

from eduphysics_fluids.geometry import Airfoil, Body, Cylinder, GeometryError, naca, segments_cross_polygon


def polygon_contains(px, py, x, y):
    """Independent even-odd ray casting test."""
    inside = np.zeros(x.shape, bool)
    for k in range(px.size):
        x1, y1, x2, y2 = px[k - 1], py[k - 1], px[k], py[k]
        crosses = (y1 > y) != (y2 > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        inside ^= crosses & (x < xi)
    return inside


@pytest.mark.parametrize("designation, thickness, camber, camber_x", [
    ("0012", 0.12, 0.0, None), ("2412", 0.12, 0.02, 0.40), ("2213", 0.13, 0.02, 0.20), ("23012", 0.12, 0.0184, 0.15)])
def test_section_shape(designation, thickness, camber, camber_x):
    s = naca(designation)
    x = np.linspace(0.0, 1.0, 100001)
    t = 2 * s.half_thickness(x)
    assert t.max() == pytest.approx(thickness, abs=2e-4)
    assert x[np.argmax(t)] == pytest.approx(0.30, abs=0.01)               # NACA thickness peaks at 30% chord
    assert t[0] == 0.0 and t[-1] == pytest.approx(0.0, abs=1e-12)         # closed trailing edge
    yc = s.camber(x)
    assert yc.max() == pytest.approx(camber, abs=2e-4)
    if camber_x is not None:
        assert x[np.argmax(yc)] == pytest.approx(camber_x, abs=0.002)
    assert s.leading_edge_radius() == pytest.approx(1.1019 * thickness**2)


def test_camber_slope_matches_finite_difference():
    for d in ("2412", "23012", "2213"):
        s = naca(d)
        x = np.linspace(0.01, 0.99, 500)
        numeric = (s.camber(x + 1e-7) - s.camber(x - 1e-7)) / 2e-7
        assert np.allclose(s.camber_slope(x), numeric, atol=1e-6)


@pytest.mark.parametrize("designation", ["0012", "2412", "23012", "2213"])
def test_inside_test_matches_polygon(designation):
    s = naca(designation)
    px, py = s.coordinates(3000)
    rng = np.random.default_rng(1)
    x, y = rng.uniform(-0.05, 1.05, 60000), rng.uniform(-0.1, 0.15, 60000)
    assert np.array_equal(s.contains(x, y), polygon_contains(px, py, x, y))


def test_surface_is_counter_clockwise_and_starts_at_trailing_edge():
    a = Airfoil("2412", 0.0)
    x, y = a.polygon(400)
    area = 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)
    assert area > 0.0                                                   # counter clockwise
    assert (x[0], y[0]) == pytest.approx((1.0, 0.0), abs=1e-12)
    assert Body.is_upper(np.array([0.1, 3.0, 3.3])).tolist() == [True, True, False]


def test_angle_of_attack_pitches_nose_up_about_leading_edge():
    a = Airfoil("0012", 10.0)
    x_te, y_te = a.to_lab(1.0, 0.0)
    assert (x_te, y_te) == pytest.approx((np.cos(np.radians(10)), -np.sin(np.radians(10))))
    assert a.to_body(x_te, y_te) == pytest.approx((1.0, 0.0))
    assert a.moment_reference() == pytest.approx(a.to_lab(0.25, 0.0))


def test_five_digit_and_invalid_designations():
    assert naca("NACA 23012").family == "5-digit"
    for bad in ("12", "0412x", "23112", "2012", "abc"):
        with pytest.raises(GeometryError):
            naca(bad)


def test_cylinder_geometry():
    c = Cylinder(2.0)
    assert c.contains(np.array([0.0, 0.99, 1.01]), np.zeros(3)).tolist() == [True, True, False]
    assert c.surface_station(np.array([np.pi, 0.0])) == pytest.approx([0.0, 180.0])


def test_segments_cross_non_convex_polygon():
    # U-shaped (non-convex) polygon: a segment across the notch must not count as crossing the body
    px = np.array([0.0, 3.0, 3.0, 2.0, 2.0, 1.0, 1.0, 0.0])
    py = np.array([0.0, 0.0, 3.0, 3.0, 1.0, 1.0, 3.0, 3.0])
    ax, ay = np.array([0.5, 1.5, -1.0, 1.0]), np.array([4.0, 2.0, 0.5, 1.0])
    bx, by = np.array([0.5, 1.5, 4.0, 2.0]), np.array([-1.0, 4.0, 0.5, 1.0])
    # through the left arm; straight down the notch; through the base; along the notch floor (edge)
    hit = segments_cross_polygon(ax, ay, bx, by, px, py)
    assert hit[:3].tolist() == [True, False, True]
