"""The binary field format shared with the TypeScript decoder (frontend/src/data/decode.ts).

The fixture under frontend/tests/fixtures is regenerated here and must match the committed file
byte for byte; the frontend unit tests decode the same file and compare with `expected`."""
import gzip
import json
from pathlib import Path

import numpy as np

from eduphysics_fluids.fields import FIELD_ORDER, NAN_CODE, decode, encode

FIXTURE = Path(__file__).resolve().parents[1] / "frontend" / "tests" / "fixtures"


def build():
    y, x = np.mgrid[0:4, 0:6].astype(float)
    a = {"u": 0.1 * x + 0.2 * y - 0.3, "v": -0.05 * y + 0.01 * x * y, "cp": np.sin(x) * np.cos(y)}
    b = {"u": 1.0 + 0.0 * x, "v": 0.3 * np.cos(x + y), "cp": x - y}
    for state in (a, b):
        for name in FIELD_ORDER:
            state[name][1, 2] = np.nan                     # one point inside the "body"
    payload, ranges = encode([a, b])
    meta = {"file": "fields.bin.gz", "encoding": "see eduphysics_fluids.fields.ENCODING", "nx": 6, "ny": 4,
            "x0": -0.5, "y0": -0.25, "spacing": 0.25, "order": list(FIELD_ORDER), "states": ["instantaneous", "mean"],
            "ranges": ranges, "nan_code": NAN_CODE}
    expected = decode(payload, 6, 4, ranges)
    data = {"meta": meta, "expected": [{k: [None if np.isnan(v) else round(float(v), 12) for v in s[k].ravel()]
                                        for k in FIELD_ORDER} for s in expected]}
    return gzip.compress(payload, compresslevel=9, mtime=0), json.dumps(data, indent=1) + "\n"


def test_fixture_is_current():
    binary, text = build()
    FIXTURE.mkdir(parents=True, exist_ok=True)
    bin_path, json_path = FIXTURE / "fields.bin.gz", FIXTURE / "fields.json"
    if not bin_path.exists() or not json_path.exists():        # first run writes it
        bin_path.write_bytes(binary)
        json_path.write_text(text)
    assert gzip.decompress(bin_path.read_bytes()) == gzip.decompress(binary)
    assert json.loads(json_path.read_text()) == json.loads(text)
