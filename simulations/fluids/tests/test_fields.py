import numpy as np

from eduphysics_fluids.fields import (FIELD_ORDER, NAN_CODE, critical_points, decode, delta_rows, dequantize, encode,
                                      quantize, undelta_rows)


def test_quantization_round_trip():
    rng = np.random.default_rng(0)
    z = rng.uniform(-2.0, 3.0, (40, 50))
    z[5, 7] = np.nan
    codes, lo, hi = quantize(z)
    assert codes[5, 7] == NAN_CODE and codes.max() <= NAN_CODE
    back = dequantize(codes, lo, hi)
    assert np.isnan(back[5, 7])
    finite = np.isfinite(z)
    assert np.max(np.abs(back[finite] - z[finite])) <= 0.5 * (hi - lo) / (NAN_CODE - 1) + 1e-12


def test_delta_coding_is_lossless():
    codes = np.random.default_rng(1).integers(0, NAN_CODE + 1, (7, 13)).astype(np.uint16)
    assert np.array_equal(undelta_rows(delta_rows(codes)), codes)


def test_encode_decode_states():
    y, x = np.mgrid[0:20, 0:30] * 0.1
    states = [{"u": np.cos(x), "v": np.sin(y), "cp": x * y}, {"u": 1 + 0 * x, "v": -x, "cp": y}]
    states[0]["u"][3, 4] = np.nan
    payload, ranges = encode(states)
    assert len(payload) == 2 * len(FIELD_ORDER) * x.size * 2
    back = decode(payload, x.shape[1], x.shape[0], ranges)
    assert np.isnan(back[0]["u"][3, 4])
    assert np.nanmax(np.abs(back[1]["v"] - states[1]["v"])) < 1e-3


def grid(n=81, spacing=0.05):
    y, x = np.mgrid[0:n, 0:n] * spacing - 2.0
    return x, y


def test_saddle_and_vortex_detection():
    X, Y = grid()
    solid = np.zeros(X.shape, bool)
    x0, y0 = 0.33, -0.21
    saddle = critical_points(X, Y, X - x0, -(Y - y0), solid, 0.05)
    assert [p["kind"] for p in saddle] == ["saddle"]
    assert abs(saddle[0]["x"] - x0) < 1e-9 and abs(saddle[0]["y"] - y0) < 1e-9
    vortex = critical_points(X, Y, -(Y - y0), X - x0, solid, 0.05)
    assert [p["kind"] for p in vortex] == ["vortex"]


def test_points_near_the_wall_are_skipped():
    X, Y = grid()
    solid = (X - 0.4) ** 2 + Y ** 2 < 0.04                             # body 0.2 from the saddle
    assert critical_points(X, Y, X - 0.2, -Y, solid, 0.05, wall_clearance=5.0) == []
