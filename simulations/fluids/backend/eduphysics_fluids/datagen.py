"""Offline generation of the dataset that the frontend loads.

Every case is an independent, impulsively started Navier-Stokes simulation. Steady cases stop when
converged; unsteady cases run to t_end and report means over the last `average_over` convective times
together with the instantaneous final state. Each case is written to disk as soon as it finishes, so a
run can be interrupted and resumed, and the manifest is rebuilt from the files that exist. Nothing is
interpolated between cases: the frontend only offers parameter combinations listed in the manifest.

Layout of the output directory:
  manifest.json                    index of all cases with their headline results
  cases/<id>.json                  coefficients, surface distributions, history, metadata
  cases/<id>.fields.bin.gz         gzip of uint16 velocity/pressure fields on a uniform grid
"""
from __future__ import annotations

import gzip
import json
import os
import platform
import subprocess
import sys
import time
import traceback
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import scipy

from . import __version__
from .analysis import (classify_flow, force_breakdown, surface_data, unsteady_statistics,
                       wall_critical_points)
from .fields import ENCODING, FIELD_ORDER, NAN_CODE, SPACING, WINDOW, critical_points, encode, to_frontend
from .geometry import Airfoil, naca
from .solver import CutCellSolver, GridSpec
from .theory import thin_airfoil

SCHEMA_VERSION = 1
AIRFOILS = ("0012", "2412", "23012", "2213")
SURFACE_STRIDE = 2                      # every second wall probe station is exported (400 of 800)

GRIDS = {
    "coarse": GridSpec(wall_spacing=0.01, chord_spacing=0.02, growth=1.10),
    "medium": GridSpec(wall_spacing=0.0075, chord_spacing=0.015, growth=1.08),
    "fine": GridSpec(),                                   # the reference solver's default grid
    "smoke": GridSpec(upstream=3.0, downstream=4.0, lateral=3.0, wall_spacing=0.03, chord_spacing=0.05, growth=1.25),
}
PRODUCTION_GRID = "medium"

# Boundary-condition explorer: one configuration, different (deliberately poor or alternative) domains.
VARIANTS = {
    "baseline": {},
    "short_inlet": {"upstream": 2.0},
    "short_outlet": {"downstream": 2.0},
    "short_outlet_zero_gradient": {"downstream": 2.0, "outlet_bc": "zero_gradient"},
    "narrow_open": {"lateral": 2.0},
    "narrow_slip": {"lateral": 2.0, "lateral_bc": "slip"},
}
BC_EXPLORER = {"airfoil": "0012", "reynolds": 500.0, "aoa": 4.0}


@dataclass(frozen=True)
class CaseSpec:
    airfoil: str
    aoa: float
    reynolds: float
    grid: str = PRODUCTION_GRID
    variant: str = "baseline"
    t_end: float = 32.0
    average_over: float = 12.0

    @property
    def case_id(self) -> str:
        base = f"naca{self.airfoil}_re{self.reynolds:g}_a{self.aoa:g}"
        return base if self.variant == "baseline" else f"{base}_{self.variant}"

    def solver_options(self):
        options = dict(VARIANTS[self.variant])
        lateral_bc = options.pop("lateral_bc", "open")
        outlet_bc = options.pop("outlet_bc", "convective")
        return replace(GRIDS[self.grid], **options), lateral_bc, outlet_bc

    def estimated_cost(self) -> float:
        """Relative cost for scheduling: the viscous time step limit makes cost grow with Re."""
        return max(self.reynolds, 300.0) * (1.0 + abs(self.aoa) / 10.0)


def angles_for(airfoil: str, angles):
    """Negative angles are only run for cambered sections (they bracket the zero-lift angle)."""
    return [a for a in angles if a >= 0.0 or not naca(airfoil).is_symmetric]


def preset(name: str) -> list[CaseSpec]:
    """Named case collections. 'core' is what ships with the frontend."""
    if name == "core":
        res, aoas = (100.0, 200.0, 500.0, 1000.0), (-4.0, 0.0, 4.0, 8.0, 12.0, 16.0, 20.0)
        return [CaseSpec(a, x, r) for a in AIRFOILS for x in angles_for(a, aoas) for r in res]
    if name == "high-re":
        return [CaseSpec(a, x, 2000.0) for a in AIRFOILS for x in angles_for(a, (-4.0, 0.0, 4.0, 8.0, 12.0, 16.0, 20.0))]
    if name == "high-re-subset":                         # the part of high-re that ships: low angles, two sections
        return [CaseSpec(a, x, 2000.0) for a in ("0012", "2412") for x in angles_for(a, (-4.0, 0.0, 4.0, 8.0))]
    if name == "fine-angles":
        res, aoas = (100.0, 200.0, 500.0, 1000.0), (2.0, 6.0, 10.0)
        return [CaseSpec(a, x, r) for a in AIRFOILS for x in aoas for r in res]
    if name == "bc":
        b = BC_EXPLORER
        return [CaseSpec(b["airfoil"], b["aoa"], b["reynolds"], variant=v) for v in VARIANTS]
    if name == "smoke":
        return [CaseSpec(a, x, r, grid="smoke", t_end=1.0, average_over=0.5)
                for a, x, r in (("0012", 4.0, 100.0), ("2412", 4.0, 400.0))]
    raise KeyError(f"Unknown preset {name!r}; choose from core, high-re, high-re-subset, fine-angles, bc, smoke")


# ---------------------------------------------------------------------------- running one case
def _round(a, digits):
    return np.round(np.asarray(a, float), digits).tolist()


def _git_commit():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True,
                              cwd=Path(__file__).parent, timeout=5).stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def run_case(spec: CaseSpec, progress=None):
    """Solve one case and post-process it. Returns (record, field_bytes)."""
    grid, lateral_bc, outlet_bc = spec.solver_options()
    body = Airfoil(spec.airfoil, spec.aoa)
    started = time.time()
    solver = CutCellSolver(body, reynolds=spec.reynolds, grid=grid, lateral_bc=lateral_bc, outlet_bc=outlet_bc)
    setup_seconds = time.time() - started
    _, _, steady = solver.solve(t_end=spec.t_end, average_over=spec.average_over, progress=progress)
    solve_seconds = time.time() - started - setup_seconds
    return postprocess(solver, spec, steady, setup_seconds, solve_seconds)


def postprocess(solver, spec: CaseSpec, steady, setup_seconds=0.0, solve_seconds=0.0):
    final = solver.state
    mean = None if steady else solver.mean_state
    representative = mean or final
    forces = force_breakdown(solver, representative)
    coefficients = {"cl": forces["cl_pressure"] + forces["cl_friction"],
                    "cd": forces["cd_pressure"] + forces["cd_friction"], **forces}
    history = solver.history
    stats = None
    if not steady:
        stats = unsteady_statistics(history, solver.mean_window[0], solver.chord, solver.u_inf)
        for k in ("cl", "cd"):
            coefficients[f"{k}_min"], coefficients[f"{k}_max"] = stats[k]["min"], stats[k]["max"]
            coefficients[f"{k}_rms"] = stats[k]["rms"]
    flow_class = classify_flow(steady, stats)

    states = [("instantaneous", final)] + ([("mean", mean)] if mean is not None else [])
    surfaces = [surface_data(solver, s) for _, s in states]
    wall_points = wall_critical_points(surfaces[-1])

    sampler = solver.field_sampler(WINDOW, SPACING)
    fields = [to_frontend(sampler(s), solver.u_inf) for _, s in states]
    field_points = critical_points(sampler.X, sampler.Y, fields[-1]["u"], fields[-1]["v"], sampler.solid,
                                   SPACING, x_max=WINDOW[1] - 0.1)
    payload, ranges = encode(fields)

    k = slice(None, None, SURFACE_STRIDE)
    s0 = surfaces[0]
    theory = thin_airfoil(solver.body.section)
    record = {
        "schema": SCHEMA_VERSION,
        "id": spec.case_id,
        "airfoil": spec.airfoil,
        "reynolds": spec.reynolds,
        "aoa_deg": spec.aoa,
        "variant": spec.variant,
        "flow": {
            "class": flow_class, "steady": bool(steady), "t_end": spec.t_end, "time": float(solver.time),
            "residual": float(solver.residual),
            "averaging_window": list(solver.mean_window) if mean is not None else None,
            "strouhal": stats["strouhal"] if stats else None,
            "peak_energy_share": stats.get("peak_energy_share") if stats else None,
        },
        "coefficients": {k: float(v) for k, v in coefficients.items()},
        "theory": {"cl_thin_airfoil": float(2 * np.pi * np.radians(spec.aoa - theory["alpha_l0_deg"])),
                   **theory},
        "surface": {
            "states": [name for name, _ in states],
            "station": _round(s0["station"][k], 5), "upper": s0["upper"][k].astype(int).tolist(),
            "x": _round(s0["x"][k], 5), "y": _round(s0["y"][k], 5),
            "cp": [_round(s["cp"][k], 5) for s in surfaces], "cf": [_round(s["cf"][k], 6) for s in surfaces],
        },
        "wall_points": wall_points,
        "field": {
            "file": f"{spec.case_id}.fields.bin.gz", "encoding": ENCODING,
            "nx": int(sampler.X.shape[1]), "ny": int(sampler.X.shape[0]), "x0": WINDOW[0], "y0": WINDOW[2],
            "spacing": SPACING, "order": list(FIELD_ORDER), "states": [name for name, _ in states],
            "ranges": ranges, "nan_code": NAN_CODE,
        },
        "field_points": field_points,
        "history": {"t": _round(history[:, 0], 4), "cl": _round(history[:, 1], 5), "cd": _round(history[:, 2], 5)},
        "solver": {
            "package_version": __version__, "grid_level": spec.grid, **solver.describe(),
            "final_dt": float(solver.dt), "steps": int(solver.steps), "setup_seconds": round(setup_seconds, 1),
            "solve_seconds": round(solve_seconds, 1), "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "git_commit": _git_commit(), "python": platform.python_version(), "numpy": np.__version__,
            "scipy": scipy.__version__, "average_over": spec.average_over,
        },
    }
    return record, payload


def write_case(record, payload, out_dir: Path):
    cases = Path(out_dir) / "cases"
    cases.mkdir(parents=True, exist_ok=True)
    tmp = cases / f".{record['id']}.tmp"
    tmp.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))   # mtime=0: reproducible bytes
    os.replace(tmp, cases / record["field"]["file"])
    tmp.write_text(json.dumps(record, separators=(",", ":")))
    os.replace(tmp, cases / f"{record['id']}.json")          # the JSON appears last: a case is complete


# ---------------------------------------------------------------------------- batch generation
def _worker(args):
    spec, out_dir, force = args if len(args) == 3 else (*args, False)
    started = time.time()
    if not force and (Path(out_dir) / "cases" / f"{spec.case_id}.json").exists():
        return f"{spec.case_id}: already present (written by another generator), skipped"
    try:
        record, payload = run_case(spec)
        write_case(record, payload, out_dir)
        c = record["coefficients"]
        return (f"{spec.case_id}: {record['flow']['class']}, C_L = {c['cl']:.4f}, C_D = {c['cd']:.4f} "
                f"({time.time() - started:.0f} s)")
    except Exception:                                            # report and continue with other cases
        return f"{spec.case_id}: FAILED\n{traceback.format_exc()}"


def generate(specs, out_dir, workers=1, force=False, cheapest_first=False, log=print):
    """Run the cases that are not on disk yet. Longest first balances a pool; a second generator
    started with cheapest_first=True on the same directory works from the other end, and each case is
    re-checked just before it starts, so the two meet in the middle without duplicating work."""
    out_dir = Path(out_dir)
    todo = [s for s in specs if force or not (out_dir / "cases" / f"{s.case_id}.json").exists()]
    todo.sort(key=lambda s: s.estimated_cost() if cheapest_first else -s.estimated_cost())
    log(f"{len(specs) - len(todo)} cases already present, {len(todo)} to run on {workers} worker(s)")
    if workers <= 1:
        for spec in todo:
            log(_worker((spec, out_dir, force)))
    else:
        with Pool(workers, maxtasksperchild=1) as pool:
            for message in pool.imap_unordered(_worker, [(s, out_dir, force) for s in todo]):
                log(message)
    return build_manifest(out_dir)


# ---------------------------------------------------------------------------- manifest
def airfoil_info(designation: str) -> dict:
    s = naca(designation)
    x = np.linspace(0.0, 1.0, 20001)
    camber, thickness = s.camber(x), 2.0 * s.half_thickness(x)
    xs, ys = s.coordinates(121)
    return {
        "id": designation, "name": f"NACA {designation}", "family": s.family,
        "thickness_ratio": s.thickness_ratio, "max_thickness_x": float(x[np.argmax(thickness)]),
        "max_camber": float(camber.max()), "max_camber_x": float(x[np.argmax(camber)]) if camber.max() > 0 else None,
        "leading_edge_radius": s.leading_edge_radius(), "theory": thin_airfoil(s),
        "outline": {"x": _round(xs, 5), "y": _round(ys, 5)},
        "camber_line": {"x": _round(x[::400], 4), "y": _round(camber[::400], 5)},
    }


def summarize(record) -> dict:
    c, f = record["coefficients"], record["flow"]
    stagnation = next((p for p in record["wall_points"] if p["kind"] == "stagnation"), None)
    separations = sorted((p for p in record["wall_points"] if p["kind"] == "separation" and p["upper"]),
                         key=lambda p: p["station"])
    entry = {"id": record["id"], "airfoil": record["airfoil"], "reynolds": record["reynolds"],
             "aoa_deg": record["aoa_deg"], "variant": record["variant"], "class": f["class"],
             "cl": round(c["cl"], 5), "cd": round(c["cd"], 5), "cm": round(c["cm"], 5),
             "cd_pressure": round(c["cd_pressure"], 5), "cd_friction": round(c["cd_friction"], 5),
             "strouhal": None if f["strouhal"] is None else round(f["strouhal"], 4),
             "stagnation_x": None if stagnation is None else round(stagnation["station"], 4),
             "stagnation_upper": None if stagnation is None else stagnation["upper"],
             "separation_x": round(separations[0]["station"], 4) if separations else None}
    for k in ("cl_min", "cl_max", "cd_min", "cd_max"):
        if k in c:
            entry[k] = round(c[k], 5)
    return entry


def build_manifest(out_dir) -> dict:
    """Collect the manifest from the case files on disk and write manifest.json."""
    manifest = collect_manifest(out_dir)
    (Path(out_dir) / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def collect_manifest(out_dir) -> dict:
    out_dir = Path(out_dir)
    records = []
    for path in sorted((out_dir / "cases").glob("*.json")):
        records.append(json.loads(path.read_text()))
    cases = [summarize(r) for r in records]
    baseline = [c for c in cases if c["variant"] == "baseline"]
    grids = {r["solver"]["grid_level"] for r in records}
    manifest = {
        "schema": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "airfoils": [airfoil_info(a) for a in AIRFOILS],
        "reynolds": sorted({c["reynolds"] for c in baseline}),
        "angles": {a: sorted({c["aoa_deg"] for c in baseline if c["airfoil"] == a}) for a in AIRFOILS},
        "bc_explorer": {**BC_EXPLORER, "variants": {
            v: {**asdict(CaseSpec(BC_EXPLORER["airfoil"], BC_EXPLORER["aoa"], BC_EXPLORER["reynolds"],
                                  variant=v).solver_options()[0]),
                "lateral_bc": VARIANTS[v].get("lateral_bc", "open"),
                "outlet_bc": VARIANTS[v].get("outlet_bc", "convective")} for v in VARIANTS}},
        "grids": {g: asdict(GRIDS[g]) for g in sorted(grids)},
        "field_window": {"x0": WINDOW[0], "x1": WINDOW[1], "y0": WINDOW[2], "y1": WINDOW[3], "spacing": SPACING},
        "cases": cases,
    }
    validation = out_dir / "validation.json"
    if validation.exists():
        manifest["validation"] = json.loads(validation.read_text())
    return manifest


if __name__ == "__main__":  # pragma: no cover
    sys.exit("Use the command line interface: python -m eduphysics_fluids --help")
