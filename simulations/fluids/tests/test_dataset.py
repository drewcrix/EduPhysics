"""Integrity of the committed dataset (simulations/fluids/data). Skipped if it has not been generated.

These checks guard what the frontend relies on, and the physical sanity of every stored case:
finite coefficients, a free stream far upstream, drag decomposition adding up, symmetric results
for the symmetric section at zero incidence, and honest labelling of unsteady runs."""
import gzip
import json
from pathlib import Path

import numpy as np
import pytest

from eduphysics_fluids.datagen import SCHEMA_VERSION, collect_manifest
from eduphysics_fluids.fields import decode

DATA = Path(__file__).resolve().parents[1] / "data"
pytestmark = pytest.mark.skipif(not (DATA / "manifest.json").exists(), reason="no dataset generated")
CLASSES = {"steady", "nearly_steady", "periodic", "irregular", "not_converged"}


@pytest.fixture(scope="module")
def manifest():
    return json.loads((DATA / "manifest.json").read_text())


@pytest.fixture(scope="module")
def records(manifest):
    return {c["id"]: json.loads((DATA / "cases" / f"{c['id']}.json").read_text()) for c in manifest["cases"]}


def test_manifest_matches_case_files(manifest):
    on_disk = sorted(p.stem for p in (DATA / "cases").glob("*.json"))
    assert sorted(c["id"] for c in manifest["cases"]) == on_disk
    current = collect_manifest(DATA)                                         # manifest.json is up to date
    assert current["cases"] == manifest["cases"] and current.get("validation") == manifest.get("validation")
    assert manifest["schema"] == SCHEMA_VERSION


def test_every_case_is_physically_sane(manifest, records):
    for entry in manifest["cases"]:
        r = records[entry["id"]]
        c = r["coefficients"]
        assert r["flow"]["class"] in CLASSES
        assert all(np.isfinite(v) for v in c.values())
        assert c["cd"] == pytest.approx(c["cd_pressure"] + c["cd_friction"], abs=1e-9)
        assert c["cd_friction"] > 0.0 and c["cd"] > 0.0                    # viscous drag is never negative
        assert abs(c["cl"] - entry["cl"]) < 1e-5
        if r["flow"]["steady"]:
            assert r["flow"]["averaging_window"] is None and len(r["surface"]["states"]) == 1
        else:
            assert r["flow"]["time"] >= r["flow"]["t_end"] and len(r["surface"]["states"]) == 2
            assert c["cl_min"] <= c["cl"] <= c["cl_max"]
        assert any(p["kind"] == "stagnation" for p in r["wall_points"])


def test_fields_decode_with_free_stream_upstream(manifest, records):
    for entry in manifest["cases"][:: max(1, len(manifest["cases"]) // 12)]:
        r = records[entry["id"]]
        f = r["field"]
        states = decode(gzip.decompress((DATA / "cases" / f["file"]).read_bytes()), f["nx"], f["ny"], f["ranges"])
        for s in states:
            upstream = s["u"][:, :4]                                         # x < -0.55 c
            # only 0.6 c ahead of the nose the body still blocks the stream: about 8 % at Re 100, alpha 20
            assert 0.85 < np.nanmean(upstream) < 1.0
            assert 0.01 < np.mean(np.isnan(s["u"])) < 0.03                   # only the airfoil is masked


def test_symmetric_section_at_zero_incidence_has_no_lift(manifest):
    for c in manifest["cases"]:
        if c["airfoil"] == "0012" and c["aoa_deg"] == 0.0 and c["class"] in ("steady", "nearly_steady"):
            assert abs(c["cl"]) < 5e-3 and abs(c["cm"]) < 2e-3


def test_lift_increases_with_angle_in_the_attached_range(manifest):
    for airfoil in {c["airfoil"] for c in manifest["cases"]}:
        for re in {c["reynolds"] for c in manifest["cases"]}:
            curve = sorted((c["aoa_deg"], c["cl"]) for c in manifest["cases"]
                           if c["airfoil"] == airfoil and c["reynolds"] == re and c["variant"] == "baseline" and c["aoa_deg"] <= 8)
            assert all(b[1] > a[1] for a, b in zip(curve, curve[1:])), (airfoil, re, curve)
