"""Solver behaviour on small grids (seconds per test)."""
import numpy as np
import pytest

from eduphysics_fluids.analysis import force_breakdown
from eduphysics_fluids.geometry import Airfoil, Body, GeometryError
from eduphysics_fluids.solver import INLET, OPEN, OUTLET, SLIP, V, CutCellSolver, GridSpec
from eduphysics_fluids.validation import symmetry_check

SMALL = GridSpec(upstream=3.0, downstream=4.0, lateral=3.0, wall_spacing=0.025, chord_spacing=0.04, growth=1.2)


@pytest.fixture(scope="module")
def solver():
    s = CutCellSolver(Airfoil("2412", 6.0), reynolds=300.0, grid=SMALL)
    for _ in range(40):
        s.step()
    return s


def boundary_flux(s):
    f, L = s.face_velocity, s.open_length
    t = s.face_type
    net = np.sum((f * L)[t == OUTLET]) - np.sum((f * L)[t == INLET])
    lateral = (t == OPEN) | (t == SLIP)
    top = lateral & (s.face_j == s.ny)
    bottom = lateral & (s.face_j == 0)
    return net + np.sum((f * L)[top]) - np.sum((f * L)[bottom])


def test_discrete_divergence_vanishes(solver):
    assert np.max(np.abs(solver.divergence_op @ solver.face_velocity)) < 1e-9
    assert abs(boundary_flux(solver)) < 1e-8                         # global mass balance


def test_time_step_respects_both_limits(solver):
    velocities = ((solver.u, solver.transverse[0][0] @ solver.v + solver.transverse[0][1]),
                  (solver.transverse[1][0] @ solver.u + solver.transverse[1][1], solver.v))
    speed2 = max(float(np.max(ux**2 + uy**2)) for ux, uy in velocities)
    assert solver.dt <= 1.8 * solver.nu / speed2 * 1.0001
    assert solver.dt <= solver.stable_time_step(velocities) * 1.0001


def test_forces_are_finite_and_cambered_section_lifts(solver):
    f = force_breakdown(solver, solver.state)
    assert all(np.isfinite(v) for v in f.values())
    assert f["cl_pressure"] > 0.0 and f["cd_friction"] > 0.0


def test_reset_reproduces_a_fresh_solver():
    a = CutCellSolver(Airfoil("0012", 4.0), reynolds=100.0, grid=SMALL)
    for _ in range(10):
        a.step()
    a.reset(400.0)
    b = CutCellSolver(Airfoil("0012", 4.0), reynolds=400.0, grid=SMALL)
    for _ in range(25):
        a.step(), b.step()
    assert np.max(np.abs(a.face_velocity - b.face_velocity)) < 1e-12


def test_mirror_symmetry_of_symmetric_section():
    result = symmetry_check(aoa=5.0, reynolds=300.0, steps=40, grid=SMALL)
    assert result["cl_plus"] > 0.05
    assert result["lift_asymmetry"] < 2e-3 and result["drag_asymmetry"] < 2e-3


def test_alternative_boundary_conditions_run():
    s = CutCellSolver(Airfoil("0012", 4.0), reynolds=200.0, grid=SMALL, lateral_bc="slip", outlet_bc="zero_gradient")
    for _ in range(20):
        s.step()
    slip = (s.face_type == SLIP) & (s.face_comp == V)
    assert slip.sum() == 2 * s.nx and np.all(s.face_velocity[slip] == 0.0)   # no flow through the walls
    assert np.all(s.p_outlet == 0.0)
    assert abs(boundary_flux(s)) < 1e-8
    with pytest.raises(ValueError):
        CutCellSolver(Airfoil("0012", 0.0), grid=SMALL, lateral_bc="periodic")


class Peanut(Body):
    """Non-convex test body: two lobes joined by a narrow waist."""
    name = "peanut"

    def surface_point(self, theta):
        r = 0.4 * (1.0 + 0.6 * np.cos(2 * np.asarray(theta)))
        return r * np.cos(theta), r * np.sin(theta)

    def contains(self, x, y):
        theta = np.arctan2(y, x)
        return np.hypot(x, y) <= 0.4 * (1.0 + 0.6 * np.cos(2 * theta))

    def surface_station(self, theta):
        return np.asarray(theta)


def test_grid_line_crossing_body_twice_is_rejected():
    with pytest.raises(GeometryError, match="crosses"):
        CutCellSolver(Peanut(), grid=SMALL)
