import numpy as np
import pytest

from eduphysics_fluids.geometry import naca
from eduphysics_fluids.theory import (blasius_friction_drag, boundary_layer_thickness, plain_flap, thin_airfoil,
                                      thin_airfoil_cl)


def test_symmetric_section_has_zero_lift_angle_and_moment():
    t = thin_airfoil(naca("0012"))
    assert t["alpha_l0_deg"] == 0.0 and t["cm_quarter_chord"] == 0.0
    assert t["lift_slope_per_rad"] == pytest.approx(2 * np.pi)


def test_naca_2412_textbook_values():
    # Anderson, Fundamentals of Aerodynamics, worked example: alpha_L0 = -2.077 deg, C_m,c/4 = -0.0532
    t = thin_airfoil(naca("2412"))
    assert t["alpha_l0_deg"] == pytest.approx(-2.077, abs=0.002)
    assert t["cm_quarter_chord"] == pytest.approx(-0.0532, abs=0.0005)


def test_camber_trends():
    a = {d: thin_airfoil(naca(d)) for d in ("2412", "2213", "23012")}
    assert all(v["alpha_l0_deg"] < 0 and v["cm_quarter_chord"] < 0 for v in a.values())
    # forward camber gives a smaller nose-down moment than camber at 40% chord
    assert abs(a["23012"]["cm_quarter_chord"]) < abs(a["2213"]["cm_quarter_chord"]) < abs(a["2412"]["cm_quarter_chord"])


def test_thin_airfoil_lift_line():
    assert thin_airfoil_cl(5.0, 0.0) == pytest.approx(2 * np.pi * np.radians(5.0))
    assert thin_airfoil_cl(-2.0, -2.0) == pytest.approx(0.0)


def test_plain_flap_limits_and_known_value():
    assert plain_flap(1.0, 10.0)["effectiveness"] == pytest.approx(1.0)        # whole plate rotates
    assert plain_flap(0.0, 10.0)["delta_cl"] == pytest.approx(0.0, abs=1e-12)
    f = plain_flap(0.25, 10.0)
    assert f["effectiveness"] == pytest.approx(0.609, abs=1e-3)
    assert f["delta_cl"] == pytest.approx(2 * np.pi * 0.609 * np.radians(10.0), rel=2e-3)
    assert f["delta_cm_quarter_chord"] < 0
    with pytest.raises(ValueError):
        plain_flap(1.5, 5.0)


def test_flat_plate_estimates():
    assert blasius_friction_drag(10000.0) == pytest.approx(0.02656)
    assert boundary_layer_thickness(2500.0) == pytest.approx(0.1)
