"""Flow fields for the frontend: resampling onto a uniform grid, 16-bit quantisation, and the critical
points of the planar velocity field (stagnation saddles and recirculation centres).

The uniform grid is a visualisation product. It is interpolated (linearly, never across the body) from
the solver's staggered face values, so it is slightly smoother than the solution itself; forces and
surface distributions are always computed from the solver data, not from this grid.
"""
from __future__ import annotations

import numpy as np
from scipy.ndimage import distance_transform_edt

WINDOW = (-0.6, 2.4, -0.9, 0.7)        # x0, x1, y0, y1 in chord lengths (leading edge at the origin)
SPACING = 0.0125
NAN_CODE = 4095                        # 12-bit codes 0..4094 carry values; 4095 marks "inside the body"
FIELD_ORDER = ("u", "v", "cp")
ENCODING = ("gzip of uint16 little endian; each row of nx codes is stored as its first code followed by "
            "successive differences modulo 65536; codes 0..4094 map linearly onto [lo, hi], 4095 = inside the body")


def quantize(z):
    """Map finite values linearly onto 0..NAN_CODE-1; NaN -> NAN_CODE. Returns (codes, lo, hi)."""
    finite = np.isfinite(z)
    lo, hi = float(np.min(z[finite])), float(np.max(z[finite]))
    scale = (hi - lo) or 1.0
    codes = np.full(z.shape, NAN_CODE, np.uint16)
    codes[finite] = np.round((z[finite] - lo) / scale * (NAN_CODE - 1)).astype(np.uint16)
    return codes, lo, hi


def dequantize(codes, lo, hi):
    z = lo + codes.astype(float) / (NAN_CODE - 1) * (hi - lo)
    z[codes == NAN_CODE] = np.nan
    return z


def delta_rows(codes):
    """Row-wise differences (mod 2^16); smooth fields then compress about twice as well."""
    return (np.diff(codes.astype(np.int64), axis=1, prepend=0) % 65536).astype("<u2")


def undelta_rows(deltas):
    return (np.cumsum(deltas.astype(np.int64), axis=1) % 65536).astype(np.uint16)


def to_frontend(fields, u_inf=1.0):
    """Velocity in units of U_inf and the pressure coefficient, in FIELD_ORDER."""
    q = 0.5 * u_inf**2
    return {"u": fields["u"] / u_inf, "v": fields["v"] / u_inf, "cp": fields["p"] / q}


def encode(fields_list):
    """Concatenate quantised, row-delta coded fields (row-major, y outermost) of one or more flow
    states in FIELD_ORDER. Returns (bytes, [{name: [lo, hi]} per state])."""
    chunks, ranges = [], []
    for fields in fields_list:
        r = {}
        for name in FIELD_ORDER:
            codes, lo, hi = quantize(fields[name])
            chunks.append(delta_rows(codes).tobytes())
            r[name] = [lo, hi]
        ranges.append(r)
    return b"".join(chunks), ranges


def decode(payload: bytes, nx: int, ny: int, ranges):
    """Inverse of encode (used by tests and offline analysis)."""
    raw = np.frombuffer(payload, "<u2").reshape(-1, ny, nx)
    states, k = [], 0
    for r in ranges:
        state = {}
        for name in FIELD_ORDER:
            state[name] = dequantize(undelta_rows(raw[k]), *r[name])
            k += 1
        states.append(state)
    return states


def critical_points(X, Y, u, v, solid, spacing, wall_clearance=2.5, max_points=16, x_max=None):
    """Zeros of the velocity field away from the wall, classified by the velocity gradient tensor J:
    det J < 0 is a saddle (a free stagnation point, e.g. where a recirculation bubble closes);
    det J > 0 with complex eigenvalues is the centre of a recirculating eddy."""
    clearance = distance_transform_edt(~solid)          # grid units to the nearest point inside the body
    corners = lambda a: (a[:-1, :-1], a[:-1, 1:], a[1:, :-1], a[1:, 1:])
    u00, u10, u01, u11 = corners(u)
    v00, v10, v01, v11 = corners(v)
    us, vs = np.stack(corners(u)), np.stack(corners(v))
    ok = (np.all(np.isfinite(us), axis=0) & np.all(np.isfinite(vs), axis=0)
          & (np.min(np.stack(corners(clearance)), axis=0) > wall_clearance))
    with np.errstate(invalid="ignore"):
        candidate = ok & (us.min(axis=0) < 0) & (us.max(axis=0) > 0) & (vs.min(axis=0) < 0) & (vs.max(axis=0) > 0)
    points = []
    for j, i in zip(*np.nonzero(candidate)):
        a = (u00[j, i], u10[j, i] - u00[j, i], u01[j, i] - u00[j, i], u11[j, i] - u10[j, i] - u01[j, i] + u00[j, i])
        b = (v00[j, i], v10[j, i] - v00[j, i], v01[j, i] - v00[j, i], v11[j, i] - v10[j, i] - v01[j, i] + v00[j, i])
        s = t = 0.5
        for _ in range(20):                             # Newton on the bilinear interpolant
            fu = a[0] + a[1] * s + a[2] * t + a[3] * s * t
            fv = b[0] + b[1] * s + b[2] * t + b[3] * s * t
            j11, j12 = a[1] + a[3] * t, a[2] + a[3] * s
            j21, j22 = b[1] + b[3] * t, b[2] + b[3] * s
            det = j11 * j22 - j12 * j21
            if abs(det) < 1e-14:
                break
            s, t = s - (fu * j22 - fv * j12) / det, t - (fv * j11 - fu * j21) / det
        if not (-1e-6 <= s <= 1 + 1e-6 and -1e-6 <= t <= 1 + 1e-6):
            continue
        jac = np.array([[a[1] + a[3] * t, a[2] + a[3] * s], [b[1] + b[3] * t, b[2] + b[3] * s]]) / spacing
        det, trace = np.linalg.det(jac), np.trace(jac)
        if det < 0:
            kind = "saddle"
        elif trace**2 < 4 * det:
            kind = "vortex"
        else:
            kind = "node"
        x, y = X[j, i] + s * spacing, Y[j, i] + t * spacing
        if x_max is not None and x > x_max:
            continue
        points.append({"kind": kind, "x": float(x), "y": float(y), "det": float(det)})
    points.sort(key=lambda p: p["x"])
    return points[:max_points]
