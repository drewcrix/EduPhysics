"""End-to-end check of the data pipeline on the tiny 'smoke' preset (a few seconds)."""
import gzip
import json

import numpy as np
import pytest

from eduphysics_fluids.datagen import AIRFOILS, CaseSpec, collect_manifest, generate, preset
from eduphysics_fluids.fields import decode


@pytest.fixture(scope="module")
def dataset(tmp_path_factory):
    out = tmp_path_factory.mktemp("data")
    manifest = generate(preset("smoke"), out, log=lambda *_: None)
    return out, manifest


def test_case_ids():
    assert CaseSpec("2412", -4.0, 500.0).case_id == "naca2412_re500_a-4"
    assert CaseSpec("0012", 4.0, 500.0, variant="narrow_slip").case_id == "naca0012_re500_a4_narrow_slip"


def test_core_preset_covers_a_full_tensor():
    specs = preset("core")
    assert len({s.case_id for s in specs}) == len(specs)
    for a in AIRFOILS:
        angles = sorted({s.aoa for s in specs if s.airfoil == a})
        assert (-4.0 in angles) == (a != "0012")                        # negative angles only when cambered
        assert len({s.reynolds for s in specs if s.airfoil == a}) == 4


def test_manifest_lists_every_case(dataset):
    out, manifest = dataset
    ids = {c["id"] for c in manifest["cases"]}
    assert ids == {s.case_id for s in preset("smoke")}
    assert manifest["reynolds"] == [100.0, 400.0]
    assert {a["id"] for a in manifest["airfoils"]} == set(AIRFOILS)
    assert manifest == {**collect_manifest(out), "generated_at": manifest["generated_at"]}
    assert json.loads((out / "manifest.json").read_text())["cases"] == manifest["cases"]


def test_case_files_are_consistent(dataset):
    out, manifest = dataset
    for entry in manifest["cases"]:
        record = json.loads((out / "cases" / f"{entry['id']}.json").read_text())
        assert record["coefficients"]["cl"] == pytest.approx(entry["cl"], abs=1e-5)
        s = record["surface"]
        n = len(s["station"])
        assert n == 400 and all(len(v) == n for v in (s["upper"], s["x"], s["y"]))
        assert len(s["cp"]) == len(s["cf"]) == len(s["states"]) == len(record["field"]["states"])
        h = record["history"]
        assert len(h["t"]) == len(h["cl"]) == len(h["cd"]) > 5
        f = record["field"]
        fields = decode(gzip.decompress((out / "cases" / f["file"]).read_bytes()), f["nx"], f["ny"], f["ranges"])
        assert len(fields) == len(f["states"])
        u = fields[0]["u"]
        assert u.shape == (f["ny"], f["nx"])
        window_area = (f["nx"] - 1) * (f["ny"] - 1) * f["spacing"] ** 2
        airfoil_area = 0.0817 if entry["airfoil"].endswith("12") else 0.0886
        assert np.mean(np.isnan(u)) == pytest.approx(airfoil_area / window_area, abs=0.002)   # only the body is masked
        assert record["flow"]["class"] in {"steady", "nearly_steady", "periodic", "irregular", "not_converged"}
        assert any(p["kind"] == "stagnation" for p in record["wall_points"])


def test_resume_skips_existing_cases(dataset):
    out, _ = dataset
    messages = []
    generate(preset("smoke"), out, log=messages.append)
    assert messages[0].startswith(f"{len(preset('smoke'))} cases already present, 0 to run")
