# Airfoil Flow Lab

Viscous, incompressible 2D flow around NACA 0012, 2412, 23012 and 2213 airfoils at Reynolds numbers
100–1000 (and 2000 for NACA 0012 and 2412 up to α = 8°), computed offline with a cut-cell Navier–Stokes solver (`backend/`) and explored in a React
viewer (`frontend/`): flow fields with streamlines and stagnation points, surface pressure and skin
friction, lift and drag curves against thin-airfoil theory, a boundary-condition explorer, high-lift
devices and the underlying theory.

* Run the viewer: `npm run dev:fluids` from the repository root.
* Tests, dataset generation, deployment: see the root `README.md`.
* Equations, numerics, validation, data format and how to extend it: [IMPLEMENTATION.md](IMPLEMENTATION.md).
