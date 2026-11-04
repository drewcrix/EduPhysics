"""Incompressible Navier-Stokes flow around a NACA 0012 airfoil.

Staggered (MAC) Cartesian grid with a sharp cut-cell airfoil, stretched to a far field 10c-20c away.
Projection method: explicit second order upwind advection, implicit diffusion, incremental pressure
correction with an exact (LU) pressure Poisson solve.
"""
import numpy as np
from scipy.optimize import brentq
from scipy.sparse import coo_matrix, identity
from scipy.sparse.linalg import splu

U, V = 0, 1                                                   # velocity components
MOMENTUM, INTERPOLATED, INLET, OPEN, OUTLET = range(5)        # face types
ORDERING = "MMD_AT_PLUS_A"                                    # fill-reducing order for the sparse LU solves


def sparse(values, rows, cols, shape):
    return coo_matrix((values, (rows, cols)), shape=shape).tocsr()


def combine(*terms):
    """Sum of weighted linear expressions [((coefficients, constant), weight), ...]."""
    coeffs, const = {}, 0.0
    for (c, k), w in terms:
        for idx, value in c.items():
            coeffs[idx] = coeffs.get(idx, 0.0) + w * value
        const += w * k
    return coeffs, const


def add_row(triplets, constant, row, expression):
    coeffs, k = expression
    for col, value in coeffs.items():
        triplets[0].append(row); triplets[1].append(col); triplets[2].append(value)
    constant[row] += k


def stretched_edges(start, stop, anchor, spacing):
    """Grid edges from start to stop, marching out from `anchor` with local cell size spacing(x)."""
    def march(direction, end):
        edges = [anchor]
        while (end - edges[-1]) * direction > 0.0:
            h = spacing(edges[-1] + 0.5 * direction * spacing(edges[-1]))
            edges.append(edges[-1] + direction * h)
        if len(edges) > 2 and abs(edges[-1] - end) > 0.5 * abs(edges[-1] - edges[-2]):
            edges.pop()                                  # merge a sliver cell into its neighbour
        edges[-1] = end
        return edges
    return np.array(march(-1.0, start)[::-1] + march(1.0, stop)[1:])


class NACA0012Solver:
    NEAR_WALL_FRACTION = 0.25   # a cut face whose centre is closer than this * h to the wall is interpolated

    def __init__(self, reynolds=100.0, aoa_deg=0.0, chord=1.0, u_inf=1.0,
                 upstream=10.0, downstream=20.0, lateral=10.0,
                 wall_spacing=0.005, chord_spacing=0.01, growth=1.05, cfl=0.5):
        """The free stream is U_inf along +x. The angle of attack pitches the airfoil nose up about its
        leading edge, so lift is the force along +y and drag the force along +x."""
        self.reynolds, self.aoa_deg = reynolds, aoa_deg
        self.alpha = np.radians(aoa_deg)
        self.chord, self.u_inf, self.cfl = chord, u_inf, cfl
        self.nu = u_inf * chord / reynolds
        self.time, self.dt, self.residual = 0.0, None, np.inf

        self.theta = np.linspace(0.0, 2.0 * np.pi, 8193)
        self.surface_x, self.surface_y = self.surface_point(self.theta)

        # Stretched grid: wall_spacing at the leading and trailing edges and across the airfoil band
        g = growth - 1.0
        x_te = self.airfoil_to_lab(1.0, 0.0)[0]
        x_lo, x_hi = self.surface_x.min(), self.surface_x.max()
        y_lo, y_hi = self.surface_y.min() - 0.02 * chord, self.surface_y.max() + 0.02 * chord
        x_spacing = lambda s: min(wall_spacing + g * abs(s), wall_spacing + g * abs(s - x_te),
                                  chord_spacing + g * max(x_lo - s, 0.0, s - x_hi))
        y_spacing = lambda s: wall_spacing + g * max(y_lo - s, 0.0, s - y_hi)
        self.x_edges = stretched_edges(-upstream * chord, downstream * chord, 0.0, x_spacing)
        self.y_edges = stretched_edges(-lateral * chord, lateral * chord, 0.0, y_spacing)
        self.nx, self.ny = self.x_edges.size - 1, self.y_edges.size - 1
        self.dx, self.dy = np.diff(self.x_edges), np.diff(self.y_edges)
        self.x_centres = 0.5 * (self.x_edges[:-1] + self.x_edges[1:])
        self.y_centres = 0.5 * (self.y_edges[:-1] + self.y_edges[1:])

        self.solid_on_line = {
            "x_edge": [self.solid_interval("vertical", x) for x in self.x_edges],
            "x_centre": [self.solid_interval("vertical", x) for x in self.x_centres],
            "y_edge": [self.solid_interval("horizontal", y) for y in self.y_edges],
            "y_centre": [self.solid_interval("horizontal", y) for y in self.y_centres],
        }
        self.build_faces()
        self.build_control_volumes()
        self.build_pressure_operators()
        self.build_momentum_operators()
        self.build_transverse_interpolation()
        self.build_surface_probes()

        # Convergence is judged near the airfoil; the far wake creeps toward the outlet long after
        box = (x_lo - chord, x_hi + 2.0 * chord, self.surface_y.min() - chord, self.surface_y.max() + chord)
        self.near_field = []
        for c in (U, V):
            mid = self.face_midpoint[self.momentum_faces[c]]
            self.near_field.append((mid[:, 0] >= box[0]) & (mid[:, 0] <= box[1])
                                   & (mid[:, 1] >= box[2]) & (mid[:, 1] <= box[3]))

        # Uniform free stream, then one projection to make it divergence free around the airfoil
        self.u = np.full(self.n_unknowns[U], u_inf)
        self.v = np.zeros(self.n_unknowns[V])
        self.p = np.zeros(self.n_volumes)
        self.u_outlet = np.full(self.outlet_faces.size, u_inf)
        self.p_outlet = np.zeros(self.outlet_faces.size)
        self.face_velocity = self.face_velocities(self.u, self.v, self.u_outlet)
        self.project(1.0, update_pressure=False)
        self.u, self.v = self.centre_velocities(self.face_velocity)
        self.u_outlet = self.face_velocity[self.outlet_faces]

    # ------------------------------------------------------------------ airfoil geometry
    @staticmethod
    def naca_half_thickness(xc):
        """Closed trailing edge NACA 0012 half thickness, with xc = x/c in [0, 1]."""
        xc = np.clip(xc, 0.0, 1.0)
        return 0.6 * (0.2969 * np.sqrt(xc) - 0.1260 * xc - 0.3516 * xc**2
                      + 0.2843 * xc**3 - 0.1036 * xc**4)

    def airfoil_to_lab(self, xc, yc):
        """Chord frame (xc along the chord, yc normal to it, both / c) to lab x, y: pitch nose up by alpha."""
        ca, sa = np.cos(self.alpha), np.sin(self.alpha)
        return self.chord * (xc * ca + yc * sa), self.chord * (yc * ca - xc * sa)

    def lab_to_airfoil(self, x, y):
        ca, sa = np.cos(self.alpha), np.sin(self.alpha)
        return (x * ca - y * sa) / self.chord, (x * sa + y * ca) / self.chord

    def surface_point(self, theta):
        """Surface point for theta in [0, 2pi]: TE -> upper surface -> LE -> lower surface -> TE (counter clockwise)."""
        xc = 0.5 * (1.0 + np.cos(theta))
        t = self.naca_half_thickness(xc)
        return self.airfoil_to_lab(xc, np.where(theta <= np.pi, t, -t))

    def is_inside_airfoil(self, x, y):
        xc, yc = self.lab_to_airfoil(np.asarray(x, float), np.asarray(y, float))
        return (xc >= 0.0) & (xc <= 1.0) & (np.abs(yc) <= self.naca_half_thickness(xc))

    def solid_interval(self, orientation, value):
        """Exact (start, end) of the part of a grid line inside the airfoil, or None."""
        along, across = (1, 0) if orientation == "vertical" else (0, 1)
        g = (self.surface_x, self.surface_y)[across] - value
        brackets = np.nonzero(np.sign(g[:-1]) * np.sign(g[1:]) <= 0.0)[0]
        if brackets.size == 0:
            return None
        hits = []
        for k in brackets:
            if g[k] == 0.0 or g[k + 1] == 0.0:
                th = self.theta[k] if g[k] == 0.0 else self.theta[k + 1]
            else:
                th = brentq(lambda t: self.surface_point(t)[across] - value,
                            self.theta[k], self.theta[k + 1], xtol=1e-15)
            hits.append(self.surface_point(th)[along])
        start, end = min(hits), max(hits)
        return (start, end) if end - start > 1e-13 else None

    @staticmethod
    def distance_to_wall(solid, position, direction, max_distance):
        if solid is None:
            return None
        if direction > 0 and solid[0] > position:
            distance = solid[0] - position
        elif direction < 0 and solid[1] < position:
            distance = position - solid[1]
        else:
            return None
        return distance if distance <= max_distance else None

    # ------------------------------------------------------------------ faces and control volumes
    def build_faces(self):
        """Cut every face into its open (fluid) segments and decide how each segment is updated.
        MOMENTUM: centre in the fluid, solved with the momentum equation. INTERPOLATED: centre in or very
        near the wall, set from a linear wall profile. INLET, OPEN (top/bottom), OUTLET: domain boundary."""
        nx, ny = self.nx, self.ny
        tol = 1e-9 * min(self.dx.min(), self.dy.min())
        rows = []
        self.faces_at = ({}, {})

        def add(comp, i, j, start, end, face_type, flux_factor=1.0, centre_wall_distance=-1.0, open_side=0):
            self.faces_at[comp].setdefault((i, j), []).append(len(rows))
            rows.append((comp, i, j, start, end, face_type, flux_factor, centre_wall_distance, open_side))

        for i in range(nx + 1):                          # u faces: vertical segments at x_edges[i]
            solid = self.solid_on_line["x_edge"][i]
            for j in range(ny):
                lo, hi = self.y_edges[j], self.y_edges[j + 1]
                if i in (0, nx):
                    add(U, i, j, lo, hi, INLET if i == 0 else OUTLET)
                    continue
                for start, end in self.open_segments(lo, hi, solid, tol):
                    add(U, i, j, start, end, *self.classify_face(start, end, lo, hi, self.y_centres[j], tol))
        for j in range(ny + 1):                          # v faces: horizontal segments at y_edges[j]
            solid = self.solid_on_line["y_edge"][j]
            for i in range(nx):
                lo, hi = self.x_edges[i], self.x_edges[i + 1]
                if j in (0, ny):
                    add(V, i, j, lo, hi, OPEN)
                    continue
                for start, end in self.open_segments(lo, hi, solid, tol):
                    add(V, i, j, start, end, *self.classify_face(start, end, lo, hi, self.x_centres[i], tol))

        cols = list(zip(*rows))
        self.face_comp, self.face_i, self.face_j = (np.array(c) for c in cols[:3])
        self.face_start, self.face_end, self.face_type = (np.array(c) for c in cols[3:6])
        self.flux_factor, self.centre_wall_distance, self.open_side = (np.array(c) for c in cols[6:])
        self.n_faces = len(rows)
        is_u = self.face_comp == U
        i_cell, j_cell = np.minimum(self.face_i, nx - 1), np.minimum(self.face_j, ny - 1)
        self.open_length = self.face_end - self.face_start
        x_pad = np.r_[self.x_edges[0], self.x_centres, self.x_edges[-1]]
        y_pad = np.r_[self.y_edges[0], self.y_centres, self.y_edges[-1]]
        self.normal_spacing = np.where(is_u, np.diff(x_pad)[np.minimum(self.face_i, nx)],
                                       np.diff(y_pad)[np.minimum(self.face_j, ny)])
        mid = 0.5 * (self.face_start + self.face_end)
        self.face_midpoint = np.where(is_u[:, None], np.c_[self.x_edges[np.minimum(self.face_i, nx)], mid],
                                      np.c_[mid, self.y_edges[np.minimum(self.face_j, ny)]])
        self.outlet_faces = np.nonzero(self.face_type == OUTLET)[0]

        # Momentum faces are the unknowns; unknown_index maps grid (j, i) -> unknown number
        self.momentum_faces, self.n_unknowns, self.unknown_index = [], [], []
        for comp, shape in ((U, (ny, nx + 1)), (V, (ny + 1, nx))):
            faces = np.nonzero((self.face_comp == comp) & (self.face_type == MOMENTUM))[0]
            index = np.full(shape, -1)
            index[self.face_j[faces], self.face_i[faces]] = np.arange(faces.size)
            self.momentum_faces.append(faces)
            self.n_unknowns.append(faces.size)
            self.unknown_index.append(index)
        self.outlet_neighbour = self.unknown_index[U][self.face_j[self.outlet_faces], nx - 1]

        # Interpolated faces: linear profile from the wall (u = 0) to the next full face along the segment
        self.anchor_unknown = np.full(self.n_faces, -1)
        anchor_length = np.ones(self.n_faces)
        for f in np.nonzero(self.face_type == INTERPOLATED)[0]:
            comp, i, j, side = self.face_comp[f], self.face_i[f], self.face_j[f], self.open_side[f]
            ai, aj = (i, j + side) if comp == U else (i + side, j)
            self.anchor_unknown[f] = self.unknown_index[comp][aj, ai]
            anchor_length[f] = self.dy[aj] if comp == U else self.dx[ai]
        self.anchor_weight = self.open_length / (2.0 * self.open_length + anchor_length)

        # Velocity at each face centre as (unknown, coefficient, constant); unknown = -1 for a known value
        self.centre_value = []
        for comp, shape in ((U, (ny, nx + 1)), (V, (ny + 1, nx))):
            known, unknown = np.zeros(shape, bool), np.full(shape, -1)
            coef, const = np.zeros(shape), np.zeros(shape)
            faces = self.momentum_faces[comp]
            known[self.face_j[faces], self.face_i[faces]] = True
            unknown[self.face_j[faces], self.face_i[faces]] = np.arange(faces.size)
            coef[self.face_j[faces], self.face_i[faces]] = 1.0
            faces = np.nonzero((self.face_comp == comp) & (self.face_type == INTERPOLATED)
                               & (self.centre_wall_distance >= 0.0))[0]
            known[self.face_j[faces], self.face_i[faces]] = True
            unknown[self.face_j[faces], self.face_i[faces]] = self.anchor_unknown[faces]
            coef[self.face_j[faces], self.face_i[faces]] = (2.0 * self.centre_wall_distance[faces]
                                                            / (2.0 * self.open_length[faces] + anchor_length[faces]))
            if comp == U:
                known[:, 0] = True; const[:, 0] = self.u_inf                                     # inlet
                known[:, nx] = True; unknown[:, nx] = self.unknown_index[U][:, nx - 1]; coef[:, nx] = 1.0
            else:                                                                                  # open: dv/dy = 0
                known[0, :] = known[ny, :] = True
                unknown[0, :], unknown[ny, :] = self.unknown_index[V][1, :], self.unknown_index[V][ny - 1, :]
                coef[0, :] = coef[ny, :] = 1.0
            self.centre_value.append((known, unknown, coef, const))

    @staticmethod
    def open_segments(lo, hi, solid, tol):
        if solid is None or solid[1] <= lo or solid[0] >= hi:
            return [(lo, hi)]
        segments = []
        if solid[0] - lo > tol:
            segments.append((lo, solid[0]))
        if hi - solid[1] > tol:
            segments.append((solid[1], hi))
        return segments

    def classify_face(self, start, end, lo, hi, centre, tol):
        """Return (type, flux_factor, centre_wall_distance, open_side) for one open face segment."""
        h = hi - lo
        if start <= lo + tol and end >= hi - tol:
            return MOMENTUM, 1.0, 0.5 * h, 0
        open_side = 1 if end >= hi - tol else -1
        if start < centre < end:
            a = centre - start if open_side > 0 else end - centre
            if a >= self.NEAR_WALL_FRACTION * h:
                return MOMENTUM, (end - start) / (2.0 * a), a, open_side
            return INTERPOLATED, 1.0, a, open_side
        return INTERPOLATED, 1.0, -1.0, open_side

    def build_control_volumes(self):
        """One pressure control volume per connected fluid region of each cell.
        Walk around the cell perimeter (S, E, N, W); open segments that touch at a corner belong together."""
        xe, ye = self.x_edges, self.y_edges
        tol = 1e-9 * min(self.dx.min(), self.dy.min())
        self.volume_minus = np.full(self.n_faces, -1)    # volume on the left / below each face
        self.volume_plus = np.full(self.n_faces, -1)     # volume on the right / above each face
        volume_cell = []
        u_faces, v_faces = self.faces_at
        start, end = self.face_start, self.face_end
        for j in range(self.ny):
            for i in range(self.nx):
                dx, dy = self.dx[i], self.dy[j]
                edges = []                               # (perimeter start, perimeter end, face, cell on plus side)
                for f in v_faces.get((i, j), ()):
                    edges.append((start[f] - xe[i], end[f] - xe[i], f, True))
                for f in u_faces.get((i + 1, j), ()):
                    edges.append((dx + start[f] - ye[j], dx + end[f] - ye[j], f, False))
                for f in v_faces.get((i, j + 1), ()):
                    edges.append((dx + dy + xe[i + 1] - end[f], dx + dy + xe[i + 1] - start[f], f, False))
                for f in u_faces.get((i, j), ()):
                    edges.append((2 * dx + dy + ye[j + 1] - end[f], 2 * dx + dy + ye[j + 1] - start[f], f, True))
                if not edges:
                    continue
                edges.sort()
                groups = []
                for s0, s1, f, plus in edges:
                    if groups and s0 <= groups[-1][1] + tol:
                        groups[-1][1] = max(groups[-1][1], s1)
                        groups[-1][2].append((f, plus))
                    else:
                        groups.append([s0, s1, [(f, plus)]])
                if len(groups) > 1 and groups[0][0] <= tol and groups[-1][1] >= 2.0 * (dx + dy) - tol:
                    groups[0][2].extend(groups.pop()[2])
                for group in groups:
                    for f, plus in group[2]:
                        (self.volume_plus if plus else self.volume_minus)[f] = len(volume_cell)
                    volume_cell.append((i, j))
        self.volume_cell = np.array(volume_cell)
        self.n_volumes = len(volume_cell)
        self.volume_area = self.dx[self.volume_cell[:, 0]] * self.dy[self.volume_cell[:, 1]]

    # ------------------------------------------------------------------ pressure operators
    def build_pressure_operators(self):
        nf, nvol, ny = self.n_faces, self.n_volumes, self.ny
        ftype, comp = self.face_type, self.face_comp
        minus, plus = self.volume_minus, self.volume_plus

        # Face velocities from the unknowns: face_velocity = to_face[U] @ u + to_face[V] @ v + face_constant
        self.face_constant = np.where(ftype == INLET, self.u_inf, 0.0)
        self.to_face = []
        for c in (U, V):
            mom = self.momentum_faces[c]
            interp = np.nonzero((comp == c) & (ftype == INTERPOLATED))[0]
            rows, cols = [mom, interp], [np.arange(mom.size), self.anchor_unknown[interp]]
            vals = [self.flux_factor[mom], self.anchor_weight[interp]]
            if c == V:                                   # open faces start from the adjacent row
                opened = np.nonzero(ftype == OPEN)[0]
                row = np.where(self.face_j[opened] == 0, 1, ny - 1)
                rows.append(opened); cols.append(self.unknown_index[V][row, self.face_i[opened]])
                vals.append(np.ones(opened.size))
            self.to_face.append(sparse(np.concatenate(vals), np.concatenate(rows), np.concatenate(cols),
                                       (nf, self.n_unknowns[c])))

        # Divergence: net outflow through the open face lengths / cell area
        has_minus, has_plus = minus >= 0, plus >= 0
        self.divergence_op = sparse(np.r_[self.open_length[has_minus] / self.volume_area[minus[has_minus]],
                                          -self.open_length[has_plus] / self.volume_area[plus[has_plus]]],
                                    np.r_[minus[has_minus], plus[has_plus]],
                                    np.r_[np.nonzero(has_minus)[0], np.nonzero(has_plus)[0]], (nvol, nf))

        # Gradient normal to each face; outlet and open faces see a boundary pressure half a cell away
        inner = np.nonzero(ftype <= INTERPOLATED)[0]
        to_top = np.nonzero((ftype == OUTLET) | ((ftype == OPEN) & (self.face_j == ny)))[0]
        to_bottom = np.nonzero((ftype == OPEN) & (self.face_j == 0))[0]
        h = self.normal_spacing
        self.gradient_op = sparse(np.r_[1.0 / h[inner], -1.0 / h[inner], -1.0 / h[to_top], 1.0 / h[to_bottom]],
                                  np.r_[inner, inner, to_top, to_bottom],
                                  np.r_[plus[inner], minus[inner], minus[to_top], plus[to_bottom]], (nf, nvol))

        # Pressure Poisson matrix (fixed geometry, factored once)
        self.poisson_lu = splu((self.divergence_op @ self.gradient_op).tocsc(), permc_spec=ORDERING)
        self.momentum_gradient = [self.gradient_op[self.momentum_faces[c]] for c in (U, V)]

        # Tiny cut cells touched only by interpolated faces never enter a momentum equation, so their
        # pressure is undetermined; report it as the weighted average of their neighbours
        in_momentum = np.zeros(nvol, bool)
        for side in (minus, plus):
            in_momentum[side[(ftype == MOMENTUM) & (side >= 0)]] = True
        self.passive_volumes, self.active_volumes = np.nonzero(~in_momentum)[0], np.nonzero(in_momentum)[0]
        weight = self.open_length[inner] / h[inner]
        adjacency = sparse(np.r_[weight, weight], np.r_[minus[inner], plus[inner]], np.r_[plus[inner], minus[inner]],
                           (nvol, nvol))
        laplacian = (sparse(np.asarray(adjacency.sum(axis=1)).ravel(), np.arange(nvol), np.arange(nvol), (nvol, nvol))
                     - adjacency).tocsr()
        passive, active = self.passive_volumes, self.active_volumes
        self.passive_lu = splu(laplacian[passive][:, passive].tocsc(), permc_spec=ORDERING) if passive.size else None
        self.passive_coupling = -laplacian[passive][:, active]

    # ------------------------------------------------------------------ momentum operators
    def centre_expression(self, comp, i, j):
        """Velocity at a face centre as ({unknown: coefficient}, constant), or None inside the airfoil."""
        known, unknown, coef, const = self.centre_value[comp]
        if not known[j, i]:
            return None
        return ({int(unknown[j, i]): coef[j, i]} if unknown[j, i] >= 0 else {}, const[j, i])

    def neighbour(self, comp, i, j, direction, step=1):
        """Neighbour `step` points away along the grid line: (expression, distance, regular).
        Uses the wall (u = 0) at its exact distance if the line hits the airfoil, and a zero-gradient
        mirror at open boundaries. `regular` marks a genuine grid value (allows second order upwind).
        For step = 2 returns None unless that point is regular."""
        horizontal = direction in ("west", "east")
        sign = -1 if direction in ("west", "south") else 1
        own = ({int(self.unknown_index[comp][j, i]): 1.0}, 0.0)
        if comp == U:
            coords = self.x_edges if horizontal else self.y_centres
            solid = self.solid_on_line["y_centre"][j] if horizontal else self.solid_on_line["x_edge"][i]
        else:
            coords = self.x_centres if horizontal else self.y_edges
            solid = self.solid_on_line["y_edge"][j] if horizontal else self.solid_on_line["x_centre"][i]
        k = i if horizontal else j
        target = k + sign * step

        if 0 <= target < coords.size:
            reach = abs(coords[target] - coords[k])
            wall = self.distance_to_wall(solid, coords[k], sign, reach)
            if wall is not None:
                return (({}, 0.0), wall, False) if step == 1 else None
            ni, nj = (target, j) if horizontal else (i, target)
            if (comp == U and ni == self.nx) or (comp == V and nj in (0, self.ny)):
                return (own, reach, False) if step == 1 else None        # zero-gradient boundary value
            return self.centre_expression(comp, ni, nj), reach, True
        if step != 1:
            return None
        edge = (self.y_edges if comp == U else self.x_edges)[-1 if sign > 0 else 0]
        half = abs(edge - coords[k])
        if comp == V and sign < 0:                                        # inlet: v = 0
            return ({}, 0.0), half, False
        return own, 2.0 * half, False                                     # open: du/dy = 0, outlet: dv/dx = 0

    def build_momentum_operators(self):
        """Laplacian (uneven three point, exact wall distances) and upwind first derivatives for u and v."""
        self.laplacian, self.laplacian_bc, self.upwind, self.upwind_spacing, self.cell_size = [], [], [], [], []
        for c in (U, V):
            n = self.n_unknowns[c]
            lap, lap_bc = ([], [], []), np.zeros(n)
            derivative = {d: (([], [], []), np.zeros(n)) for d in ("x-", "x+", "y-", "y+")}
            spacing = {d: np.zeros(n) for d in ("west", "east", "south", "north")}
            for r, f in enumerate(self.momentum_faces[c]):
                i, j = self.face_i[f], self.face_j[f]
                own = ({r: 1.0}, 0.0)
                for axis, (back, front) in (("x", ("west", "east")), ("y", ("south", "north"))):
                    e_back, h_back, reg_back = self.neighbour(c, i, j, back)
                    e_front, h_front, reg_front = self.neighbour(c, i, j, front)
                    spacing[back][r], spacing[front][r] = h_back, h_front
                    w_back, w_front = 2.0 / ((h_back + h_front) * h_back), 2.0 / ((h_back + h_front) * h_front)
                    add_row(lap, lap_bc, r, combine((own, -(w_back + w_front)), (e_back, w_back), (e_front, w_front)))
                    # backward difference (flow in +) and forward difference (flow in -)
                    for key, d, e1, h1, regular, sgn in ((axis + "-", back, e_back, h_back, reg_back, 1.0),
                                                         (axis + "+", front, e_front, h_front, reg_front, -1.0)):
                        far = self.neighbour(c, i, j, d, 2) if regular else None
                        if far is not None:              # second order on uneven spacing
                            h2 = far[1] - h1
                            terms = ((own, sgn * (2 * h1 + h2) / (h1 * (h1 + h2))),
                                     (e1, -sgn * (h1 + h2) / (h1 * h2)), (far[0], sgn * h1 / (h2 * (h1 + h2))))
                        else:                            # first order next to walls and boundaries
                            terms = ((own, sgn / h1), (e1, -sgn / h1))
                        add_row(derivative[key][0], derivative[key][1], r, combine(*terms))
            self.laplacian.append(sparse(lap[2], lap[0], lap[1], (n, n)))
            self.laplacian_bc.append(lap_bc)
            self.upwind.append({k: (sparse(t[2], t[0], t[1], (n, n)), b) for k, (t, b) in derivative.items()})
            self.upwind_spacing.append(spacing)
            fi, fj = self.face_i[self.momentum_faces[c]], self.face_j[self.momentum_faces[c]]
            if c == U:
                self.cell_size.append((0.5 * (self.x_edges[fi + 1] - self.x_edges[fi - 1]), self.dy[fj]))
            else:
                self.cell_size.append((self.dx[fi], 0.5 * (self.y_edges[fj + 1] - self.y_edges[fj - 1])))

    def interpolate_along_line(self, solid, s_a, e_a, s_b, e_b, s):
        """Linear interpolation between points a and b on a grid line, stopping at the wall (u = 0)."""
        zero = ({}, 0.0)
        if solid is not None:
            if solid[0] <= s <= solid[1]:
                return zero
            if s_a <= solid[1] < s:
                s_a, e_a = solid[1], zero
            if s < solid[0] <= s_b:
                s_b, e_b = solid[0], zero
        w = (s - s_a) / (s_b - s_a)
        return combine((e_a, 1.0 - w), (e_b, w))

    def build_transverse_interpolation(self):
        """v at u faces and u at v faces (the cross advecting velocity), two 1D wall-aware interpolations."""
        xe, ye, xc, yc = self.x_edges, self.y_edges, self.x_centres, self.y_centres
        line, cv = self.solid_on_line, self.centre_expression
        self.transverse = []
        for c in (U, V):
            rows, const = ([], [], []), np.zeros(self.n_unknowns[c])
            for r, f in enumerate(self.momentum_faces[c]):
                i, j = self.face_i[f], self.face_j[f]
                if c == U:
                    left = self.interpolate_along_line(line["x_centre"][i - 1], ye[j], cv(V, i - 1, j), ye[j + 1], cv(V, i - 1, j + 1), yc[j])
                    right = self.interpolate_along_line(line["x_centre"][i], ye[j], cv(V, i, j), ye[j + 1], cv(V, i, j + 1), yc[j])
                    value = self.interpolate_along_line(line["y_centre"][j], xc[i - 1], left, xc[i], right, xe[i])
                else:
                    below = self.interpolate_along_line(line["y_centre"][j - 1], xe[i], cv(U, i, j - 1), xe[i + 1], cv(U, i + 1, j - 1), xc[i])
                    above = self.interpolate_along_line(line["y_centre"][j], xe[i], cv(U, i, j), xe[i + 1], cv(U, i + 1, j), xc[i])
                    value = self.interpolate_along_line(line["x_centre"][i], yc[j - 1], below, yc[j], above, ye[j])
                add_row(rows, const, r, value)
            self.transverse.append((sparse(rows[2], rows[0], rows[1], (self.n_unknowns[c], self.n_unknowns[1 - c])), const))

    # ------------------------------------------------------------------ time stepping
    def face_velocities(self, u, v, u_outlet):
        """Mean normal velocity over the open part of every face."""
        face_velocity = self.to_face[U] @ u + self.to_face[V] @ v + self.face_constant
        face_velocity[self.outlet_faces] = u_outlet
        return face_velocity

    def centre_velocities(self, face_velocity):
        return tuple(face_velocity[self.momentum_faces[c]] / self.flux_factor[self.momentum_faces[c]] for c in (U, V))

    def advection_term(self, c, q, ux, uy):
        """(u . grad) q with upwinding chosen by the sign of the local advecting velocity."""
        d = self.upwind[c]
        dq_dx = np.where(ux >= 0.0, d["x-"][0] @ q + d["x-"][1], d["x+"][0] @ q + d["x+"][1])
        dq_dy = np.where(uy >= 0.0, d["y-"][0] @ q + d["y-"][1], d["y+"][0] @ q + d["y+"][1])
        return ux * dq_dx + uy * dq_dy

    def stable_time_step(self, velocities):
        """Advective CFL limit plus the second order upwind limit dt < 2 nu / |u|^2.
        Points so close to the wall that viscosity dominates (cell Peclet < 2) do not limit dt."""
        rate, speed2 = 0.0, 1e-30
        for c, (ux, uy) in enumerate(velocities):
            s, (size_x, size_y) = self.upwind_spacing[c], self.cell_size[c]
            hx = np.maximum(np.where(ux >= 0.0, s["west"], s["east"]), np.minimum(size_x, 2.0 * self.nu / (np.abs(ux) + 1e-30)))
            hy = np.maximum(np.where(uy >= 0.0, s["south"], s["north"]), np.minimum(size_y, 2.0 * self.nu / (np.abs(uy) + 1e-30)))
            rate = max(rate, float(np.max(np.abs(ux) / hx + np.abs(uy) / hy)))
            speed2 = max(speed2, float(np.max(ux**2 + uy**2)))
        return min(self.cfl / rate, 1.8 * self.nu / speed2)

    def set_time_step(self, dt):
        """Implicit diffusion matrix (I - dt nu L) is refactored only when dt changes."""
        self.dt = dt
        self.diffusion_lu = [splu((identity(self.n_unknowns[c], format="csc") - dt * self.nu * self.laplacian[c]).tocsc(),
                                   permc_spec=ORDERING) for c in (U, V)]

    def project(self, dt, outlet_increment=None, update_pressure=True):
        """Pressure Poisson equation D G phi = D u* / dt, then u = u* - dt G phi.
        The outlet pressure is a Dirichlet value; its increment enters as a known boundary gradient."""
        boundary = np.zeros(self.n_faces)
        if outlet_increment is not None:
            boundary[self.outlet_faces] = outlet_increment / self.normal_spacing[self.outlet_faces]
        phi = self.poisson_lu.solve(self.divergence_op @ (self.face_velocity / dt - boundary))
        self.face_velocity -= dt * (self.gradient_op @ phi + boundary)
        if update_pressure:
            self.p += phi
        error = float(np.max(np.abs(self.divergence_op @ self.face_velocity)))
        if not error < 1e-9:
            raise RuntimeError(f"Pressure projection failed: divergence = {error:.3e}")

    def step(self):
        velocities = ((self.u, self.transverse[U][0] @ self.v + self.transverse[U][1]),
                      (self.transverse[V][0] @ self.u + self.transverse[V][1], self.v))
        dt_max = self.stable_time_step(velocities)
        if self.dt is None or self.dt > dt_max or self.dt < 0.7 * dt_max:
            self.set_time_step(0.95 * dt_max)
        dt = self.dt

        # 1) predictor: explicit advection, implicit diffusion, old pressure gradient
        predicted = []
        for c, (q, (ux, uy)) in enumerate(zip((self.u, self.v), velocities)):
            rhs = q + dt * (self.nu * self.laplacian_bc[c] - self.advection_term(c, q, ux, uy)
                            - self.momentum_gradient[c] @ self.p)
            predicted.append(self.diffusion_lu[c].solve(rhs))
        # convective outlet du/dt + U_inf du/dx = 0, traction-free outlet pressure p = 2 nu du/dx
        u_outlet = self.u_outlet - dt * self.u_inf * (self.u_outlet - self.u[self.outlet_neighbour]) / self.dx[-1]
        p_outlet = 2.0 * self.nu * (u_outlet - predicted[U][self.outlet_neighbour]) / self.dx[-1]
        # 2) corrector: pressure Poisson equation and projection
        self.face_velocity = self.face_velocities(*predicted, u_outlet)
        self.project(dt, outlet_increment=p_outlet - self.p_outlet)
        self.p_outlet, self.u_outlet = p_outlet, self.face_velocity[self.outlet_faces]

        u, v = self.centre_velocities(self.face_velocity)
        near_u, near_v = self.near_field
        self.residual = max(np.max(np.abs(u - self.u)[near_u]), np.max(np.abs(v - self.v)[near_v])) / dt
        self.u, self.v = u, v
        self.time += dt

    def solve(self, t_end=40.0, tolerance=1e-4, average_over=10.0, sample_every=0.05):
        """March in time, sampling C_L and C_D. Stops when the flow near the airfoil is steady
        (residual < tolerance and both coefficients changing by < tolerance per unit time).
        If it is still unsteady at t_end the mean over the last `average_over` time units is returned.
        self.history holds (t, C_L, C_D, residual). Returns (C_L, C_D, steady)."""
        history, next_sample = [], self.time
        while self.time < t_end:
            self.step()
            if self.time >= next_sample:
                history.append((self.time, *self.force_coefficients(), self.residual))
                next_sample += sample_every
                earlier = [h for h in history if h[0] <= self.time - 1.0]
                if earlier and self.residual < tolerance:
                    change = max(abs(a - b) for a, b in zip(history[-1][1:], earlier[-1][1:])) / (self.time - earlier[-1][0])
                    if change < tolerance:
                        break
        self.history = np.array(history)
        steady = self.time < t_end
        if steady:
            return self.history[-1, 1], self.history[-1, 2], True
        window = self.history[:, 0] >= self.time - average_over
        return self.history[window, 1].mean(), self.history[window, 2].mean(), False

    # ------------------------------------------------------------------ surface pressure, shear and forces
    def volume_pressure(self):
        p = self.p.copy()
        if self.passive_lu is not None:
            p[self.passive_volumes] = self.passive_lu.solve(self.passive_coupling @ self.p[self.active_volumes])
        return p

    def face_pressure(self):
        p = self.volume_pressure()
        minus = np.where(self.volume_minus >= 0, p[np.maximum(self.volume_minus, 0)], np.nan)
        plus = np.where(self.volume_plus >= 0, p[np.maximum(self.volume_plus, 0)], np.nan)
        face_p = np.where(np.isnan(minus), plus, np.where(np.isnan(plus), minus, 0.5 * (minus + plus)))
        face_p = np.where(self.face_type == OPEN, 0.0, face_p)
        face_p[self.outlet_faces] = self.p_outlet
        return face_p

    def surface_polygon(self, n):
        """n surface points (counter clockwise) with unit outward normals and vertex-centred lengths."""
        x, y = self.surface_point(np.linspace(0.0, 2.0 * np.pi, n + 1)[:-1])
        ex, ey = np.roll(x, -1) - x, np.roll(y, -1) - y
        length = np.hypot(ex, ey)
        nx_, ny_ = ey + np.roll(ey, 1), -(ex + np.roll(ex, 1))
        norm = np.hypot(nx_, ny_)
        return x, y, nx_ / norm, ny_ / norm, 0.5 * (length + np.roll(length, 1))

    def segments_cross_airfoil(self, ax, ay, bx, by):
        """Exact clip of segments a-b against the convex airfoil polygon; True if a segment passes through it."""
        px, py = self.surface_point(np.linspace(0.0, 2.0 * np.pi, 1601)[:-1])
        ex, ey = np.roll(px, -1) - px, np.roll(py, -1) - py
        hit = np.zeros(ax.size, bool)
        for s in range(0, ax.size, 4000):
            k = slice(s, s + 4000)
            num = (px - ax[k, None]) * ey - (py - ay[k, None]) * ex
            den = (bx[k] - ax[k])[:, None] * ey - (by[k] - ay[k])[:, None] * ex
            with np.errstate(divide="ignore", invalid="ignore"):
                r = num / den
            t_in = np.maximum(np.max(np.where(den < 0.0, r, -np.inf), axis=1), 0.0)
            t_out = np.minimum(np.min(np.where(den > 0.0, r, np.inf), axis=1), 1.0)
            hit[k] = ~np.any((den == 0.0) & (num < 0.0), axis=1) & (t_out - t_in > 1e-9)
        return hit

    def interpolation_matrix(self, xs, ys, on_wall, px, py):
        """Sparse linear interpolation from scattered samples to points (px, py) that never bridges the
        airfoil: triangles inside it or crossing it are removed. Points left uncovered get empty rows."""
        from matplotlib.tri import Triangulation
        tri = Triangulation(xs, ys)
        t = tri.triangles
        bad = on_wall[t].all(axis=1) | self.is_inside_airfoil(xs[t].mean(axis=1), ys[t].mean(axis=1))
        margin = 0.05 * self.chord
        box = (self.surface_x.min() - margin, self.surface_x.max() + margin,
               self.surface_y.min() - margin, self.surface_y.max() + margin)
        for k in range(3):
            a, b = t[:, k], t[:, (k + 1) % 3]
            near = ((np.maximum(xs[a], xs[b]) >= box[0]) & (np.minimum(xs[a], xs[b]) <= box[1])
                    & (np.maximum(ys[a], ys[b]) >= box[2]) & (np.minimum(ys[a], ys[b]) <= box[3]))
            e = np.nonzero(near & ~(on_wall[a] & on_wall[b]) & ~bad)[0]
            bad[e] |= self.segments_cross_airfoil(xs[a[e]], ys[a[e]], xs[b[e]], ys[b[e]])
        tri.set_mask(bad)
        found = tri.get_trifinder()(px, py)
        rows = np.nonzero(found >= 0)[0]
        v = t[found[rows]]
        x1, x2, x3 = xs[v[:, 0]], xs[v[:, 1]], xs[v[:, 2]]
        y1, y2, y3 = ys[v[:, 0]], ys[v[:, 1]], ys[v[:, 2]]
        det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
        l1 = ((y2 - y3) * (px[rows] - x3) + (x3 - x2) * (py[rows] - y3)) / det
        l2 = ((y3 - y1) * (px[rows] - x3) + (x1 - x3) * (py[rows] - y3)) / det
        weights = np.c_[l1, l2, 1.0 - l1 - l2]
        return sparse(weights.ravel(), np.repeat(rows, 3), v.ravel(), (px.size, xs.size)), found < 0

    def face_samples(self, box, components=(U, V), with_wall=None):
        """Interpolation matrix from face values (global face index) to points, using faces inside `box`
        plus optional zero-valued wall points."""
        mid = self.face_midpoint
        faces = np.nonzero(np.isin(self.face_comp, components) & (mid[:, 0] >= box[0]) & (mid[:, 0] <= box[1])
                           & (mid[:, 1] >= box[2]) & (mid[:, 1] <= box[3]))[0]
        wx, wy = with_wall if with_wall is not None else (np.empty(0), np.empty(0))
        xs, ys = np.r_[mid[faces, 0], wx], np.r_[mid[faces, 1], wy]
        on_wall = np.r_[np.zeros(faces.size, bool), np.ones(wx.size, bool)]
        def to_points(px, py):
            m, missing = self.interpolation_matrix(xs, ys, on_wall, px, py)
            m = m[:, :faces.size].tocoo()                # wall samples are zero
            return sparse(m.data, m.row, faces[m.col], (px.size, self.n_faces)), missing
        return to_points

    def build_surface_probes(self, n=800):
        """Probes one and two local cells out along each wall normal (fixed geometry, built once)."""
        x, y, nx_, ny_, length = self.surface_polygon(n)
        ix = np.clip(np.searchsorted(self.x_edges, x) - 1, 0, self.nx - 1)
        iy = np.clip(np.searchsorted(self.y_edges, y) - 1, 0, self.ny - 1)
        h = np.maximum(self.dx[ix], self.dy[iy])
        px = np.r_[x + h * nx_, x + 2 * h * nx_]
        py = np.r_[y + h * ny_, y + 2 * h * ny_]
        pad = 0.3 * self.chord
        box = (self.surface_x.min() - pad, self.surface_x.max() + pad, self.surface_y.min() - pad, self.surface_y.max() + pad)
        self.probe = {"x": x, "y": y, "nx": nx_, "ny": ny_, "length": length, "h": h}
        for name, comps, wall in (("u", (U,), (x, y)), ("v", (V,), (x, y)), ("p", (U, V), None)):
            self.probe[name], missing = self.face_samples(box, comps, wall)(px, py)
            if missing.any():
                raise RuntimeError("Surface probe outside the interpolation; check the grid near the airfoil.")

    def surface_distribution(self):
        """Wall pressure and shear from the probes.
        p_wall: linear extrapolation of p at h and 2h to the wall.
        tau_wall = nu du_t/dn from u_t(d) = a d + b d^2 through u_t(0) = 0 at d = h and 2h."""
        pr, n = self.probe, self.probe["x"].size
        p = pr["p"] @ self.face_pressure()
        u, v = pr["u"] @ self.face_velocity, pr["v"] @ self.face_velocity
        tx, ty = -pr["ny"], pr["nx"]                     # tangent along the counter clockwise surface
        ut = u * np.r_[tx, tx] + v * np.r_[ty, ty]
        p_wall = 2.0 * p[:n] - p[n:]
        tau_wall = self.nu * (4.0 * ut[:n] - ut[n:]) / (2.0 * pr["h"])
        return p_wall, tau_wall, tx, ty

    def force_coefficients(self):
        """(C_L, C_D) from the surface integral of pressure and viscous shear. Free stream along +x."""
        pr = self.probe
        p_wall, tau_wall, tx, ty = self.surface_distribution()
        fx = np.sum((-p_wall * pr["nx"] + tau_wall * tx) * pr["length"])
        fy = np.sum((-p_wall * pr["ny"] + tau_wall * ty) * pr["length"])
        q = 0.5 * self.u_inf**2 * self.chord
        return fy / q, fx / q

    def pressure_coefficient(self):
        """(x/c, C_p, upper) on the surface, with p_inf = 0 on the open boundaries."""
        p_wall, _, _, _ = self.surface_distribution()
        xc, yc = self.lab_to_airfoil(self.probe["x"], self.probe["y"])
        return xc, 2.0 * p_wall / self.u_inf**2, yc > 0.0

    # ------------------------------------------------------------------ plotting
    def flow_on_grid(self, window, spacing):
        """Velocity and C_p on a uniform plotting grid, interpolated up to the exact surface."""
        from scipy.ndimage import distance_transform_edt
        x0, x1, y0, y1 = window
        X, Y = np.meshgrid(np.arange(x0, x1 + 0.5 * spacing, spacing), np.arange(y0, y1 + 0.5 * spacing, spacing))
        solid = self.is_inside_airfoil(X, Y)
        wx, wy = self.probe["x"], self.probe["y"]
        p_wall = self.surface_distribution()[0]
        pad = 0.25 * self.chord
        mid = self.face_midpoint
        in_box = (mid[:, 0] >= x0 - pad) & (mid[:, 0] <= x1 + pad) & (mid[:, 1] >= y0 - pad) & (mid[:, 1] <= y1 + pad)
        fields = {}
        for name, faces, values, wall_values in (
                ("u", in_box & (self.face_comp == U), self.face_velocity, np.zeros(wx.size)),
                ("v", in_box & (self.face_comp == V), self.face_velocity, np.zeros(wx.size)),
                ("cp", in_box, self.face_pressure(), p_wall)):
            xs, ys = np.r_[mid[faces, 0], wx], np.r_[mid[faces, 1], wy]
            on_wall = np.r_[np.zeros(faces.sum(), bool), np.ones(wx.size, bool)]
            m, missing = self.interpolation_matrix(xs, ys, on_wall, X.ravel(), Y.ravel())
            z = m @ np.r_[values[faces], wall_values]
            fields[name] = np.where(missing, np.nan, z).reshape(X.shape)
        fields["cp"] *= 2.0 / self.u_inf**2
        for name, z in fields.items():                   # fill the thin uncovered band at the wall
            gap = np.isnan(z)
            if gap.any():
                nearest = distance_transform_edt(gap, return_distances=False, return_indices=True)
                fields[name] = z[nearest[0], nearest[1]]
        for name in ("u", "v"):
            fields[name] = np.ma.array(fields[name], mask=solid)
        return X, Y, fields, solid, (wx, wy)

    def plot(self, window=(-0.75, 2.25, -1.0, 1.0), spacing=0.005, filename=None):
        """Velocity magnitude with streamlines, C_p field, and surface C_p (upper and lower)."""
        import matplotlib.pyplot as plt
        X, Y, f, solid, (wx, wy) = self.flow_on_grid(window, spacing)
        speed = np.ma.sqrt(f["u"]**2 + f["v"]**2) / self.u_inf
        fig = plt.figure(figsize=(16, 9.5))
        grid = fig.add_gridspec(2, 2, height_ratios=[1.0, 0.85])
        ax_u, ax_p, ax_c = fig.add_subplot(grid[0, 0]), fig.add_subplot(grid[0, 1]), fig.add_subplot(grid[1, :])
        im = ax_u.contourf(X, Y, speed, levels=np.linspace(0.0, float(speed.max()), 21), cmap="viridis")
        ax_u.streamplot(X, Y, f["u"], f["v"], density=1.4, linewidth=0.6, color="w", arrowsize=0.6)
        fig.colorbar(im, ax=ax_u, label="|u| / U$_\\infty$", shrink=0.8)
        cp_fluid = f["cp"][~solid]
        levels = np.linspace(max(cp_fluid.min(), -3.0), min(cp_fluid.max(), 1.5), 25)
        im = ax_p.contourf(X, Y, f["cp"], levels=levels, cmap="RdBu_r", extend="both")
        ax_p.contour(X, Y, f["cp"], levels=levels, colors="k", linewidths=0.3)
        fig.colorbar(im, ax=ax_p, label="$C_p$", shrink=0.8)
        for ax, name in ((ax_u, "Velocity magnitude and streamlines"), (ax_p, "Pressure coefficient")):
            ax.fill(wx, wy, facecolor="white", edgecolor="black", linewidth=1.0, zorder=10)
            ax.set(xlim=window[:2], ylim=window[2:], aspect="equal", xlabel="x / c", ylabel="y / c", title=name)
        xc, cp, upper = self.pressure_coefficient()
        for mask, label, style in ((upper, "upper surface", "-"), (~upper, "lower surface", "--")):
            order = np.argsort(xc[mask])
            ax_c.plot(xc[mask][order], cp[mask][order], style, lw=1.6, label=label)
        ax_c.invert_yaxis()
        ax_c.set(xlabel="x / c", ylabel="$C_p$", title="Surface pressure coefficient")
        ax_c.grid(alpha=0.3); ax_c.legend(frameon=False)
        cl, cd = self.force_coefficients()
        fig.suptitle(f"NACA 0012, Re = {self.reynolds:g}, AoA = {self.aoa_deg:g} deg, t = {self.time:.1f}:  "
                     f"C_L = {cl:.3f}, C_D = {cd:.3f}", fontsize=12)
        fig.tight_layout()
        if filename:
            fig.savefig(filename, dpi=110)
            plt.close(fig)
        else:
            plt.show()


if __name__ == "__main__":
    import sys
    reynolds = float(sys.argv[1]) if len(sys.argv) > 1 else 100.0
    aoa_deg = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0
    solver = NACA0012Solver(reynolds=reynolds, aoa_deg=aoa_deg)
    print(f"Grid {solver.nx} x {solver.ny} cells, {solver.n_volumes} pressure volumes")
    cl, cd, steady = solver.solve()
    print(f"t = {solver.time:.2f}, residual = {solver.residual:.1e}, {'steady' if steady else 'time-averaged'}: "
          f"C_L = {cl:.4f}, C_D = {cd:.4f}")
    solver.plot()
