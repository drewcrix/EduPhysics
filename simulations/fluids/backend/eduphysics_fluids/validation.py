"""Numerical validation of the solver against independent references.

* Steady flow past a circular cylinder at Re_D = 20 and 40: drag coefficient, length of the closed
  recirculation bubble behind the cylinder and the separation angle, compared with the classical
  results of Dennis & Chang (1970, J. Fluid Mech. 42), Fornberg (1980, J. Fluid Mech. 98) and the
  experiments of Coutanceau & Bouard (1977, J. Fluid Mech. 79) and Tritton (1959, J. Fluid Mech. 6).
  This exercises the same cut-cell walls, force integration and wall-shear analysis as the airfoils.
* Mirror symmetry: NACA 0012 at +alpha and -alpha must give C_L of opposite sign and equal C_D.
* Grid convergence: one case on the coarse, medium and fine grids (see IMPLEMENTATION.md).
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np

from .analysis import force_breakdown, surface_data, wall_critical_points
from .geometry import Airfoil, Cylinder
from .solver import CutCellSolver, GridSpec

# Published values and the acceptance band used for this solver (domain 10D up, 20D down, +-10D open
# sides, so a few per cent of confinement and grid error is expected).
CYLINDER_REFERENCES = {
    20.0: {"cd": {"dennis_chang_1970": 2.045, "fornberg_1980": 2.00, "tritton_1959_exp": 2.09},
           "recirculation_length": {"dennis_chang_1970": 0.94, "fornberg_1980": 0.91, "coutanceau_bouard_1977_exp": 0.93},
           "separation_angle_deg": {"dennis_chang_1970": 43.7},
           "accept": {"cd": (1.95, 2.20), "recirculation_length": (0.84, 1.03), "separation_angle_deg": (40.5, 47.0)}},
    40.0: {"cd": {"dennis_chang_1970": 1.522, "fornberg_1980": 1.498, "tritton_1959_exp": 1.59},
           "recirculation_length": {"dennis_chang_1970": 2.345, "fornberg_1980": 2.24, "coutanceau_bouard_1977_exp": 2.13},
           "separation_angle_deg": {"dennis_chang_1970": 53.8},
           "accept": {"cd": (1.45, 1.68), "recirculation_length": (2.0, 2.5), "separation_angle_deg": (50.5, 57.0)}},
}
CYLINDER_GRID = GridSpec(upstream=10.0, downstream=20.0, lateral=10.0, wall_spacing=0.02, chord_spacing=0.02, growth=1.08)


def cylinder_benchmark(reynolds=40.0, grid: GridSpec = CYLINDER_GRID, t_end=120.0) -> dict:
    """Steady cylinder flow; lengths in diameters, recirculation length measured from the rear surface."""
    started = time.time()
    solver = CutCellSolver(Cylinder(1.0), reynolds=reynolds, grid=grid)
    cl, cd, steady = solver.solve(t_end=t_end)
    state = solver.state
    forces = force_breakdown(solver, state)

    # Recirculation length: where the centreline velocity behind the cylinder turns positive again
    sample = solver.field_sampler((0.5, 5.0, -0.0125, 0.0125), 0.0025)
    u = sample(state)["u"]
    centre = u[u.shape[0] // 2]
    x = sample.X[0]
    negative = np.nonzero(centre < 0.0)[0]
    length = None
    if negative.size:
        k = negative[-1]
        if k + 1 < x.size:
            length = float(x[k] - centre[k] * (x[k + 1] - x[k]) / (centre[k + 1] - centre[k]) - 0.5)

    surf = surface_data(solver, state)
    separations = [p for p in wall_critical_points(surf) if p["kind"] in ("separation", "trailing_edge")]
    angle = float(np.mean([180.0 - p["station"] for p in separations])) if separations else None
    return {"reynolds": reynolds, "steady": bool(steady), "time": float(solver.time),
            "cd": float(cd), "cl": float(cl), "cd_pressure": forces["cd_pressure"], "cd_friction": forces["cd_friction"],
            "recirculation_length": length, "separation_angle_deg": angle,
            "cp_front": float(surf["cp"].max()), "grid": solver.describe(), "wall_seconds": round(time.time() - started, 1)}


def check_cylinder(result) -> dict:
    """Pass/fail of each quantity against the acceptance band."""
    accept = CYLINDER_REFERENCES[result["reynolds"]]["accept"]
    return {k: (result[k] is not None and lo <= result[k] <= hi) for k, (lo, hi) in accept.items()}


def symmetry_check(aoa=6.0, reynolds=500.0, steps=150, grid: GridSpec | None = None) -> dict:
    """C_L(+alpha) + C_L(-alpha) and C_D(+alpha) - C_D(-alpha) after the same number of steps.
    The grids are exact mirror images, so these vanish up to round-off and the (non-unique) Delaunay
    triangulation used to place the wall probes."""
    grid = grid or GridSpec(upstream=4.0, downstream=6.0, lateral=4.0, wall_spacing=0.015, chord_spacing=0.03, growth=1.12)
    results = {}
    for sign in (1.0, -1.0):
        s = CutCellSolver(Airfoil("0012", sign * aoa), reynolds=reynolds, grid=grid)
        for _ in range(steps):
            s.step()
        f = force_breakdown(s, s.state)
        results[sign] = (f["cl_pressure"] + f["cl_friction"], f["cd_pressure"] + f["cd_friction"], f["cm"])
    (cl_p, cd_p, cm_p), (cl_m, cd_m, cm_m) = results[1.0], results[-1.0]
    return {"cl_plus": cl_p, "cl_minus": cl_m, "lift_asymmetry": abs(cl_p + cl_m),
            "drag_asymmetry": abs(cd_p - cd_m), "moment_asymmetry": abs(cm_p + cm_m)}


def update_validation_file(path, key, value):
    """Store validation results next to the dataset; the manifest embeds them for the frontend."""
    path = Path(path)
    data = json.loads(path.read_text()) if path.exists() else {}
    data[key] = value
    path.write_text(json.dumps(data, indent=1))
    return data
