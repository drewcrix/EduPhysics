"""Body geometry for the cut-cell solver.

A body is a closed, simple contour described by a parameter theta in [0, 2 pi] that runs counter
clockwise. For airfoils theta = 0 is the trailing edge, theta in (0, pi) the upper surface, theta = pi
the leading edge and theta in (pi, 2 pi) the lower surface, with x/c = (1 + cos theta) / 2 along the
camber line (cosine clustering at both edges).

Sections:
  NACA 4-digit  "MPTT": max camber M % at P/10 chord, thickness TT %.
  NACA 5-digit  "LPQTT" with Q = 0 (standard, non-reflexed) camber lines.
Thickness is applied perpendicular to the camber line (the original NACA construction). The trailing
edge is closed by using -0.1036 instead of -0.1015 for the x^4 coefficient, as in the reference solver.

A circular cylinder is provided only to validate the solver against classical benchmarks.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# NACA 5-digit standard camber lines (design C_L = 0.3): P -> (r, k1). Abbott & von Doenhoff (1959).
_FIVE_DIGIT_CAMBER = {1: (0.0580, 361.400), 2: (0.1260, 51.640), 3: (0.2025, 15.957),
                      4: (0.2900, 6.643), 5: (0.3910, 3.230)}


class GeometryError(ValueError):
    """The requested body / grid combination is outside what the cut-cell solver supports."""


@dataclass(frozen=True)
class NacaSection:
    """Shape of a NACA section in chord units (x/c in [0, 1])."""
    designation: str
    thickness_ratio: float
    family: str                         # "4-digit" or "5-digit"
    max_camber: float = 0.0             # 4-digit: m
    camber_position: float = 0.0        # 4-digit: p;  5-digit: r (transition point)
    k1: float = 0.0                     # 5-digit camber scale

    @property
    def is_symmetric(self) -> bool:
        return self.family == "4-digit" and self.max_camber == 0.0

    def half_thickness(self, x):
        """Half thickness t(x) / c, closed trailing edge."""
        x = np.clip(x, 0.0, 1.0)
        return 5.0 * self.thickness_ratio * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x**2
                                             + 0.2843 * x**3 - 0.1036 * x**4)

    def camber(self, x):
        """Camber line y_c(x) / c."""
        x = np.clip(np.asarray(x, float), 0.0, 1.0)
        if self.family == "4-digit":
            m, p = self.max_camber, self.camber_position
            if m == 0.0:
                return np.zeros_like(x)
            return np.where(x < p, m / p**2 * (2 * p * x - x**2),
                            m / (1 - p)**2 * ((1 - 2 * p) + 2 * p * x - x**2))
        r, k1 = self.camber_position, self.k1
        return np.where(x < r, k1 / 6.0 * (x**3 - 3 * r * x**2 + r**2 * (3 - r) * x),
                        k1 * r**3 / 6.0 * (1 - x))

    def camber_slope(self, x):
        x = np.clip(np.asarray(x, float), 0.0, 1.0)
        if self.family == "4-digit":
            m, p = self.max_camber, self.camber_position
            if m == 0.0:
                return np.zeros_like(x)
            return np.where(x < p, 2 * m / p**2 * (p - x), 2 * m / (1 - p)**2 * (p - x))
        r, k1 = self.camber_position, self.k1
        return np.where(x < r, k1 / 6.0 * (3 * x**2 - 6 * r * x + r**2 * (3 - r)), -k1 * r**3 / 6.0)

    def camber_curvature(self, x):
        """d^2 y_c / dx^2 (piecewise smooth)."""
        x = np.clip(np.asarray(x, float), 0.0, 1.0)
        if self.family == "4-digit":
            m, p = self.max_camber, self.camber_position
            if m == 0.0:
                return np.zeros_like(x)
            return np.where(x < p, -2 * m / p**2, -2 * m / (1 - p)**2)
        r, k1 = self.camber_position, self.k1
        return np.where(x < r, k1 * (x - r), 0.0)

    def surface(self, theta):
        """Chord-frame surface point (x, y) / c for parameter theta (see module docstring)."""
        theta = np.asarray(theta, float)
        xc = 0.5 * (1.0 + np.cos(theta))
        t = self.half_thickness(xc) * np.where(theta <= np.pi, 1.0, -1.0)
        slope = self.camber_slope(xc)
        norm = np.sqrt(1.0 + slope**2)
        return xc - t * slope / norm, self.camber(xc) + t / norm

    def contains(self, x, y):
        """Exact inside test in the chord frame.

        Every interior point is C(s) + n N(s) for a unique camber station s in [0, 1] and |n| <= t(s),
        because the camber curvature is far smaller than 1/t. Newton's method finds the foot point s
        where (P - C(s)) is normal to the camber line."""
        x, y = np.asarray(x, float), np.asarray(y, float)
        s = np.clip(x, 0.0, 1.0)
        for _ in range(25):
            yc, slope, curv = self.camber(s), self.camber_slope(s), self.camber_curvature(s)
            f = (x - s) + (y - yc) * slope
            df = -1.0 - slope**2 + (y - yc) * curv
            s = np.clip(s - f / df, -0.25, 1.25)
        norm = np.sqrt(1.0 + self.camber_slope(s)**2)
        n = ((y - self.camber(s)) - (x - s) * self.camber_slope(s)) / norm
        return (s >= 0.0) & (s <= 1.0) & (np.abs(n) <= self.half_thickness(s))

    def leading_edge_radius(self) -> float:
        return 1.1019 * self.thickness_ratio**2

    def coordinates(self, n=161):
        """Closed chord-frame outline (TE -> upper -> LE -> lower -> TE), cosine clustered."""
        theta = np.linspace(0.0, 2.0 * np.pi, 2 * n - 1)
        return self.surface(theta)


def naca(designation: str) -> NacaSection:
    """NACA 4-digit ('2412') or standard 5-digit ('23012') section."""
    d = designation.strip().upper().removeprefix("NACA").strip()
    if not d.isdigit():
        raise GeometryError(f"Not a NACA designation: {designation!r}")
    if len(d) == 4:
        m, p, t = int(d[0]) / 100.0, int(d[1]) / 10.0, int(d[2:]) / 100.0
        if (m == 0.0) != (p == 0.0):
            raise GeometryError(f"NACA {d}: camber and camber position must both be zero or non-zero")
        return NacaSection(d, t, "4-digit", max_camber=m, camber_position=p)
    if len(d) == 5:
        design_cl, position, reflex, t = int(d[0]) * 0.15, int(d[1]), int(d[2]), int(d[3:]) / 100.0
        if reflex != 0 or position not in _FIVE_DIGIT_CAMBER:
            raise GeometryError(f"NACA {d}: only standard (Q = 0, P = 1..5) 5-digit camber lines are supported")
        r, k1 = _FIVE_DIGIT_CAMBER[position]
        return NacaSection(d, t, "5-digit", camber_position=r, k1=k1 * design_cl / 0.3)
    raise GeometryError(f"Unsupported NACA designation {designation!r}")


class Body:
    """A closed contour in the lab frame (free stream along +x)."""
    name = "body"
    reference_length = 1.0
    grid_anchor = (0.0, 0.0)            # stretched grids march outward from this point

    def surface_point(self, theta):
        raise NotImplementedError

    def contains(self, x, y):
        raise NotImplementedError

    def refinement_x(self):
        """Lab x positions (leading/trailing edges) where the grid uses its finest spacing."""
        return [self.grid_anchor[0]]

    def moment_reference(self):
        return self.grid_anchor

    def surface_station(self, theta):
        """Coordinate used to plot surface distributions (x/c for airfoils)."""
        raise NotImplementedError

    @staticmethod
    def is_upper(theta):
        return np.asarray(theta) <= np.pi

    def polygon(self, n):
        """n vertices, counter clockwise, theta_k = 2 pi k / n."""
        return self.surface_point(np.linspace(0.0, 2.0 * np.pi, n + 1)[:-1])

    def describe(self) -> dict:
        return {"name": self.name}


class Airfoil(Body):
    """NACA section of chord c pitched nose up by the angle of attack about its leading edge."""

    def __init__(self, section: NacaSection | str, aoa_deg: float = 0.0, chord: float = 1.0):
        self.section = naca(section) if isinstance(section, str) else section
        self.aoa_deg = float(aoa_deg)
        self.alpha = np.radians(self.aoa_deg)
        self.chord = self.reference_length = float(chord)
        self.name = f"NACA {self.section.designation}"

    def to_lab(self, xc, yc):
        """Chord frame (both / c) to lab x, y: pitch nose up by alpha."""
        ca, sa = np.cos(self.alpha), np.sin(self.alpha)
        return self.chord * (xc * ca + yc * sa), self.chord * (yc * ca - xc * sa)

    def to_body(self, x, y):
        ca, sa = np.cos(self.alpha), np.sin(self.alpha)
        return (x * ca - y * sa) / self.chord, (x * sa + y * ca) / self.chord

    def surface_point(self, theta):
        return self.to_lab(*self.section.surface(theta))

    def contains(self, x, y):
        return self.section.contains(*self.to_body(np.asarray(x, float), np.asarray(y, float)))

    def refinement_x(self):
        return [self.to_lab(0.0, 0.0)[0], self.to_lab(1.0, 0.0)[0]]

    def moment_reference(self):
        return self.to_lab(0.25, 0.0)

    def surface_station(self, theta):
        return self.to_body(*self.surface_point(theta))[0]

    def describe(self) -> dict:
        s = self.section
        return {"name": self.name, "designation": s.designation, "family": s.family,
                "thickness_ratio": s.thickness_ratio, "aoa_deg": self.aoa_deg, "chord": self.chord}


class Cylinder(Body):
    """Circular cylinder of diameter D centred at the origin (validation only)."""

    def __init__(self, diameter: float = 1.0):
        self.diameter = self.reference_length = float(diameter)
        self.name = "cylinder"

    def surface_point(self, theta):
        r = 0.5 * self.diameter
        return r * np.cos(np.asarray(theta, float)), r * np.sin(np.asarray(theta, float))

    def contains(self, x, y):
        return np.hypot(x, y) <= 0.5 * self.diameter

    def refinement_x(self):
        r = 0.5 * self.diameter
        return [-r, 0.0, r]

    def surface_station(self, theta):
        """Angle from the front stagnation point, degrees (0 at the front, 180 at the rear)."""
        return np.degrees(np.abs(np.pi - np.asarray(theta, float)))

    @staticmethod
    def is_upper(theta):
        return np.asarray(theta) <= np.pi

    def describe(self) -> dict:
        return {"name": self.name, "diameter": self.diameter}


def segments_cross_polygon(ax, ay, bx, by, px, py, chunk=1500):
    """True for each segment a-b whose interior passes through the inside of the closed polygon (px, py).

    Works for non-convex polygons. Segment end points are either outside the polygon or exactly on one
    of its vertices, so a segment enters the inside only if it crosses the boundary somewhere strictly
    between its ends (it must leave again to reach its other end). Intersections at the end points
    themselves (t ~ 0 or 1) are ignored."""
    ex, ey = np.roll(px, -1) - px, np.roll(py, -1) - py
    hit = np.zeros(ax.size, bool)
    for s in range(0, ax.size, chunk):
        k = slice(s, s + chunk)
        dx, dy = (bx[k] - ax[k])[:, None], (by[k] - ay[k])[:, None]
        wx, wy = px[None, :] - ax[k, None], py[None, :] - ay[k, None]
        den = dx * ey - dy * ex
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (wx * ey - wy * ex) / den                # along the segment
            u = (wx * dy - wy * dx) / den                # along the polygon edge
        crossing = (den != 0.0) & (t > 1e-7) & (t < 1.0 - 1e-7) & (u >= 0.0) & (u < 1.0)
        hit[k] = crossing.any(axis=1)
    return hit
