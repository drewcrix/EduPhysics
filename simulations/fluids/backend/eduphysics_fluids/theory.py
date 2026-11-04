"""Analytical reference results used for comparison with the CFD. None of these are Navier-Stokes
solutions; the frontend labels them as theory.

Thin-airfoil theory (inviscid, small angles, thin sections, Kutta condition at a sharp trailing edge),
with the classical substitution x/c = (1 - cos th) / 2, th in [0, pi] from leading to trailing edge:
  alpha_L0   = -(1/pi) int_0^pi (dz/dx) (cos th - 1) d th
  A_n        =  (2/pi) int_0^pi (dz/dx) cos(n th) d th
  C_L        =  2 pi (alpha - alpha_L0)
  C_m,c/4    =  (pi/4) (A_2 - A_1)
"""
from __future__ import annotations

import numpy as np
from scipy.integrate import quad

from .geometry import NacaSection


def _theta_of_x(x):
    return np.arccos(1.0 - 2.0 * x)


def thin_airfoil(section: NacaSection) -> dict:
    """Zero-lift angle, lift slope and quarter-chord moment of the section's camber line."""
    slope = lambda th: float(section.camber_slope(0.5 * (1.0 - np.cos(th))))
    kinks = [] if section.is_symmetric else [_theta_of_x(section.camber_position)]
    integrate = lambda f: quad(f, 0.0, np.pi, points=kinks or None, limit=200, epsabs=1e-12, epsrel=1e-12)[0]
    alpha_l0 = -integrate(lambda th: slope(th) * (np.cos(th) - 1.0)) / np.pi
    a1 = 2.0 * integrate(lambda th: slope(th) * np.cos(th)) / np.pi
    a2 = 2.0 * integrate(lambda th: slope(th) * np.cos(2.0 * th)) / np.pi
    return {"alpha_l0_deg": float(np.degrees(alpha_l0)), "lift_slope_per_rad": float(2.0 * np.pi),
            "cm_quarter_chord": float(np.pi / 4.0 * (a2 - a1))}


def thin_airfoil_cl(alpha_deg, alpha_l0_deg):
    return 2.0 * np.pi * np.radians(np.asarray(alpha_deg, float) - alpha_l0_deg)


def plain_flap(flap_chord_ratio: float, deflection_deg: float) -> dict:
    """Thin-airfoil increments for a plain trailing-edge flap of chord E c deflected by delta (down
    positive) on a thin section: hinge at x_h = (1 - E) c, cos th_h = 2E - 1.
      effectiveness tau = 1 - (th_h - sin th_h) / pi,   dC_L = 2 pi tau delta,
      dC_m,c/4 = -(delta / 2) sin th_h (1 - cos th_h)."""
    if not 0.0 <= flap_chord_ratio <= 1.0:
        raise ValueError("flap chord ratio must be in [0, 1]")
    th_h = np.arccos(2.0 * flap_chord_ratio - 1.0)
    delta = np.radians(deflection_deg)
    tau = 1.0 - (th_h - np.sin(th_h)) / np.pi
    return {"effectiveness": float(tau), "delta_cl": float(2.0 * np.pi * tau * delta),
            "delta_alpha_l0_deg": float(-np.degrees(tau * delta)),
            "delta_cm_quarter_chord": float(-0.5 * delta * np.sin(th_h) * (1.0 - np.cos(th_h)))}


def blasius_friction_drag(reynolds):
    """Skin-friction drag of a flat plate wetted on both sides, laminar Blasius boundary layer:
    C_D,f = 2 x 1.328 / sqrt(Re_c). Valid for Re_c >> 1; at Re_c ~ 100 leading-edge and finite-length
    effects make the real value noticeably larger."""
    return 2.0 * 1.328 / np.sqrt(np.asarray(reynolds, float))


def boundary_layer_thickness(reynolds, x=1.0):
    """Blasius 99% thickness delta/c = 5.0 x / sqrt(Re_x) at station x/c (flat plate estimate)."""
    return 5.0 * x / np.sqrt(np.asarray(reynolds, float) * x)
