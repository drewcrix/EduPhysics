"""Command line interface: python -m eduphysics_fluids <command> (or the eduphysics-fluids script).

  run        solve one case and print its summary (optionally save it and plot it)
  generate   run named case presets into the dataset directory (resumable, parallel)
  manifest   rebuild data/manifest.json from the case files present
  validate   cylinder benchmark, mirror-symmetry check
  plot       figure of a generated case
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

DEFAULT_DATA = Path(__file__).resolve().parents[2] / "data"


def _cmd_run(args):
    from .datagen import CaseSpec, run_case, write_case
    spec = CaseSpec(args.airfoil, args.aoa, args.re, grid=args.grid, variant=args.variant,
                    t_end=args.t_end, average_over=args.average_over)
    last = [-1]
    def progress(s):                                     # one line per convective time unit
        if int(s.time) > last[0]:
            last[0] = int(s.time)
            print(f"  t = {s.time:6.2f}  residual = {s.residual:.2e}", flush=True)
    record, payload = run_case(spec, progress=progress if args.verbose else None)
    c, f = record["coefficients"], record["flow"]
    print(json.dumps({"id": record["id"], "class": f["class"], "time": round(f["time"], 3),
                      "cl": c["cl"], "cd": c["cd"], "cm": c["cm"], "cd_pressure": c["cd_pressure"],
                      "cd_friction": c["cd_friction"], "strouhal": f["strouhal"],
                      "wall_points": record["wall_points"], "solve_seconds": record["solver"]["solve_seconds"]}, indent=1))
    if args.out:
        write_case(record, payload, args.out)
        if args.plot:
            from .plotting import plot_case
            plot_case(Path(args.out) / "cases" / f"{record['id']}.json", args.plot)


def _cmd_generate(args):
    from .datagen import generate, preset
    specs = [s for name in args.preset for s in preset(name)]
    manifest = generate(specs, args.out, workers=args.workers, force=args.force, cheapest_first=args.cheapest_first)
    print(f"manifest: {len(manifest['cases'])} cases")


def _cmd_manifest(args):
    from .datagen import build_manifest
    print(f"manifest: {len(build_manifest(args.out)['cases'])} cases")


def _cmd_validate(args):
    from .validation import check_cylinder, cylinder_benchmark, symmetry_check, update_validation_file
    target = Path(args.out) / "validation.json"
    if args.check in ("cylinder", "all"):
        rows = []
        for re in args.re:
            result = cylinder_benchmark(re)
            result["passed"] = check_cylinder(result)
            rows.append(result)
            print(json.dumps(result, indent=1))
        update_validation_file(target, "cylinder", rows)
    if args.check in ("symmetry", "all"):
        result = symmetry_check()
        print(json.dumps(result, indent=1))
        update_validation_file(target, "symmetry", result)


def _cmd_plot(args):
    from .plotting import plot_case
    plot_case(args.case, args.output)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="eduphysics-fluids", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("run", help="solve one case")
    p.add_argument("--airfoil", default="0012")
    p.add_argument("--re", type=float, default=500.0)
    p.add_argument("--aoa", type=float, default=4.0)
    p.add_argument("--grid", default="medium", choices=["coarse", "medium", "fine", "smoke"])
    p.add_argument("--variant", default="baseline")
    p.add_argument("--t-end", type=float, default=32.0)
    p.add_argument("--average-over", type=float, default=12.0)
    p.add_argument("--out", type=Path, help="also write the case into this dataset directory")
    p.add_argument("--plot", type=Path, help="with --out: save a PNG figure of the case")
    p.add_argument("--verbose", action="store_true")
    p.set_defaults(func=_cmd_run)

    p = sub.add_parser("generate", help="run case presets into the dataset")
    p.add_argument("--preset", action="append", required=True,
                   help="core, high-re, high-re-subset, fine-angles, bc or smoke (repeatable)")
    p.add_argument("--out", type=Path, default=DEFAULT_DATA)
    p.add_argument("--workers", type=int, default=1)
    p.add_argument("--force", action="store_true", help="recompute cases that already exist")
    p.add_argument("--cheapest-first", action="store_true",
                   help="run cheap cases first (lets a second generator share the work with a running one)")
    p.set_defaults(func=_cmd_generate)

    p = sub.add_parser("manifest", help="rebuild manifest.json")
    p.add_argument("--out", type=Path, default=DEFAULT_DATA)
    p.set_defaults(func=_cmd_manifest)

    p = sub.add_parser("validate", help="benchmarks against independent references")
    p.add_argument("check", choices=["cylinder", "symmetry", "all"])
    p.add_argument("--re", type=float, nargs="+", default=[20.0, 40.0])
    p.add_argument("--out", type=Path, default=DEFAULT_DATA)
    p.set_defaults(func=_cmd_validate)

    p = sub.add_parser("plot", help="plot a generated case")
    p.add_argument("case", type=Path)
    p.add_argument("--output", type=Path)
    p.set_defaults(func=_cmd_plot)

    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
