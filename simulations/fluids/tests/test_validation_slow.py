"""Slow numerical validation (pytest -m slow): several minutes each."""
import sys
from pathlib import Path

import numpy as np
import pytest

from eduphysics_fluids.analysis import force_coefficients
from eduphysics_fluids.geometry import Airfoil
from eduphysics_fluids.solver import CutCellSolver, GridSpec
from eduphysics_fluids.validation import CYLINDER_REFERENCES, check_cylinder, cylinder_benchmark

REFERENCE = Path(__file__).resolve().parents[3] / "fluid_flow_simulator" / "naca0012_solver.py"


@pytest.mark.slow
@pytest.mark.parametrize("reynolds", sorted(CYLINDER_REFERENCES))
def test_cylinder_matches_published_steady_flow(reynolds):
    result = cylinder_benchmark(reynolds)
    assert result["steady"]
    assert abs(result["cl"]) < 1e-3                                       # symmetric steady wake
    passed = check_cylinder(result)
    assert all(passed.values()), (result, passed)


@pytest.mark.slow
@pytest.mark.skipif(not REFERENCE.exists(), reason="reference solver (fluid_flow_simulator/) not present")
def test_port_reproduces_the_reference_solver():
    """Same grid, same steps: the generalised solver must reproduce the original NACA 0012 solver."""
    sys.path.insert(0, str(REFERENCE.parent))
    from naca0012_solver import NACA0012Solver

    kw = dict(upstream=5.0, downstream=8.0, lateral=5.0, wall_spacing=0.01, chord_spacing=0.02, growth=1.1)
    ref = NACA0012Solver(reynolds=500.0, aoa_deg=6.0, **kw)
    new = CutCellSolver(Airfoil("0012", 6.0), reynolds=500.0, grid=GridSpec(**kw))
    assert np.array_equal(ref.face_type, new.face_type) and ref.n_volumes == new.n_volumes
    for _ in range(150):
        ref.step(), new.step()
    assert np.max(np.abs(ref.face_velocity - new.face_velocity)) < 1e-10
    assert np.max(np.abs(ref.p - new.p)) < 1e-8
    cl_ref, cd_ref = ref.force_coefficients()
    cl, cd, _ = force_coefficients(new, new.state)
    # Post-processing differs only in the (non-unique) Delaunay triangulation of the wall probes
    assert cl == pytest.approx(cl_ref, rel=2e-3) and cd == pytest.approx(cd_ref, rel=2e-3)
