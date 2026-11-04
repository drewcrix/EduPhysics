"""Matplotlib figures of a generated case (optional dependency), for checking results offline.
Reads the same files the frontend reads, so it also verifies the exported data."""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import numpy as np

from .fields import decode


def load_case(path):
    path = Path(path)
    record = json.loads(path.read_text())
    f = record["field"]
    payload = gzip.decompress((path.parent / f["file"]).read_bytes())
    fields = decode(payload, f["nx"], f["ny"], f["ranges"])
    x = f["x0"] + f["spacing"] * np.arange(f["nx"])
    y = f["y0"] + f["spacing"] * np.arange(f["ny"])
    return record, np.meshgrid(x, y), fields


def plot_case(path, filename=None, state=-1):
    """Velocity magnitude with streamlines, C_p field and surface C_p, like the reference solver's plot.
    state = -1 shows the time average for unsteady cases (the final snapshot for steady ones)."""
    import matplotlib.pyplot as plt

    record, (X, Y), fields = load_case(path)
    f = fields[state]
    speed = np.hypot(f["u"], f["v"])
    fig = plt.figure(figsize=(16, 9.5))
    grid = fig.add_gridspec(2, 2, height_ratios=[1.0, 0.85])
    ax_u, ax_p, ax_c = fig.add_subplot(grid[0, 0]), fig.add_subplot(grid[0, 1]), fig.add_subplot(grid[1, :])
    im = ax_u.contourf(X, Y, speed, levels=21, cmap="viridis")
    ax_u.streamplot(X, Y, np.nan_to_num(f["u"]), np.nan_to_num(f["v"]), density=1.4, linewidth=0.6, color="w", arrowsize=0.6)
    fig.colorbar(im, ax=ax_u, label="|u| / U$_\\infty$", shrink=0.8)
    cp = f["cp"]
    levels = np.linspace(max(np.nanmin(cp), -3.0), min(np.nanmax(cp), 1.5), 25)
    im = ax_p.contourf(X, Y, cp, levels=levels, cmap="RdBu_r", extend="both")
    fig.colorbar(im, ax=ax_p, label="$C_p$", shrink=0.8)
    s = record["surface"]
    for ax, name in ((ax_u, "Velocity magnitude and streamlines"), (ax_p, "Pressure coefficient")):
        ax.fill(s["x"], s["y"], facecolor="white", edgecolor="black", linewidth=1.0, zorder=10)
        ax.set(aspect="equal", xlabel="x / c", ylabel="y / c", title=name)
    station, upper = np.array(s["station"]), np.array(s["upper"], bool)
    cps = np.array(s["cp"][state])
    for mask, label, style in ((upper, "upper surface", "-"), (~upper, "lower surface", "--")):
        order = np.argsort(station[mask])
        ax_c.plot(station[mask][order], cps[mask][order], style, lw=1.6, label=label)
    ax_c.invert_yaxis()
    ax_c.set(xlabel="x / c", ylabel="$C_p$", title="Surface pressure coefficient")
    ax_c.grid(alpha=0.3); ax_c.legend(frameon=False)
    c = record["coefficients"]
    fig.suptitle(f"NACA {record['airfoil']}, Re = {record['reynolds']:g}, AoA = {record['aoa_deg']:g} deg "
                 f"({record['flow']['class']}):  C_L = {c['cl']:.3f}, C_D = {c['cd']:.3f}", fontsize=12)
    fig.tight_layout()
    if filename:
        fig.savefig(filename, dpi=110)
        plt.close(fig)
    else:
        plt.show()
