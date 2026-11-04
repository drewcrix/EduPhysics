"""C_L versus angle of attack from naca0012_solver, compared with thin airfoil theory C_L = 2 pi alpha.

Each angle is an independent simulation. Steady cases stop when converged; unsteady cases (vortex shedding)
are averaged over the last `AVERAGE_OVER` convective times. Stall is whatever the CFD produces: the script
only reports the angle of maximum mean C_L, and says so if the maximum sits at the last angle run.
Usage: python naca0012_lift_curve.py [reynolds] [first_deg] [last_deg] [step_deg]
"""
import sys
from multiprocessing import Pool

import numpy as np

from naca0012_solver import NACA0012Solver

GRID = dict(wall_spacing=0.005, chord_spacing=0.01)   # medium grid; see naca0012_validation.py
T_END, AVERAGE_OVER = 40.0, 15.0


def run_angle(args):
    reynolds, aoa = args
    solver = NACA0012Solver(reynolds=reynolds, aoa_deg=aoa, **GRID)
    cl, cd, steady = solver.solve(t_end=T_END, average_over=AVERAGE_OVER)
    window = solver.history[:, 0] >= solver.time - AVERAGE_OVER
    cl_min, cl_max = solver.history[window, 1].min(), solver.history[window, 1].max()
    print(f"Re {reynolds:g}, AoA {aoa:5.1f} deg: C_L = {cl:.4f} (range {cl_min:.4f} to {cl_max:.4f}), "
          f"C_D = {cd:.4f}, {'steady' if steady else 'unsteady'}", flush=True)
    return aoa, cl, cd, steady, cl_min, cl_max


def main():
    import matplotlib.pyplot as plt
    reynolds = float(sys.argv[1]) if len(sys.argv) > 1 else 100.0
    first, last, step = (float(a) for a in sys.argv[2:5]) if len(sys.argv) > 4 else (0.0, 32.0, 4.0)
    angles = np.arange(first, last + 0.5 * step, step)
    with Pool(2) as pool:
        rows = np.array(sorted(pool.map(run_angle, [(reynolds, a) for a in angles])))
    aoa, cl, cd, steady, cl_min, cl_max = rows.T
    np.savetxt(f"lift_curve_re{reynolds:g}.csv", rows, delimiter=",",
               header="aoa_deg,cl,cd,steady,cl_min,cl_max", comments="")

    k = int(np.argmax(cl))
    if k == aoa.size - 1:
        print(f"Maximum C_L at the last angle ({aoa[k]:g} deg): stall not reached, extend the sweep.")
    else:
        print(f"Maximum mean C_L = {cl[k]:.3f} at {aoa[k]:g} deg; C_L falls beyond it (stall from the CFD).")
    slope = np.polyfit(np.radians(aoa[aoa <= 5.0]), cl[aoa <= 5.0], 1)[0] if np.sum(aoa <= 5.0) > 1 else np.nan
    print(f"Lift curve slope below 5 deg: {slope:.3f} per rad (thin airfoil theory: {2 * np.pi:.3f})")

    fig, ax = plt.subplots(figsize=(8, 5))
    a_theory = np.linspace(0.0, aoa.max(), 50)
    ax.plot(a_theory, 2 * np.pi * np.radians(a_theory), "k--", label="thin airfoil theory, $C_L = 2\\pi\\alpha$")
    ax.fill_between(aoa, cl_min, cl_max, color="C0", alpha=0.2, label="C_L range over the averaging window")
    ax.plot(aoa, cl, "o-", color="C0", label=f"CFD, Re = {reynolds:g} (open markers: unsteady mean)")
    ax.plot(aoa[steady == 0], cl[steady == 0], "o", mfc="white", color="C0")
    ax.set(xlabel="angle of attack (deg)", ylabel="$C_L$", title=f"NACA 0012 lift curve, Re = {reynolds:g}")
    ax.set_ylim(0.0, max(1.2 * cl_max.max(), 0.5))
    ax.grid(alpha=0.3); ax.legend(frameon=False)
    fig.tight_layout(); fig.savefig(f"lift_curve_re{reynolds:g}.png", dpi=110)


if __name__ == "__main__":
    main()
