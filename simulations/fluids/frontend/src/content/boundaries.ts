/** Texts for the boundary-condition explorer. Keys match datagen.VARIANTS. */
export const variantText: Record<string, { title: string; what: string; expect: string }> = {
  baseline: {
    title: 'Baseline domain',
    what: 'Inlet 10c upstream, outlet 20c downstream, open sides 10c above and below; convective outlet. The domain used for every case in the simulator.',
    expect: 'The reference result.',
  },
  short_inlet: {
    title: 'Inlet only 2c upstream',
    what: 'The uniform-velocity inlet is moved to 2c ahead of the leading edge.',
    expect: 'A lifting airfoil disturbs the flow far upstream (upwash, and blockage from the thick viscous layers). Forcing the flow to be exactly uniform so close constrains it artificially.',
  },
  short_outlet: {
    title: 'Outlet only 2c downstream',
    what: 'The convective, traction-free outlet is moved to 2c behind the leading edge, so the wake leaves the domain one chord behind the trailing edge.',
    expect: 'A convective outlet lets the wake leave with little reflection, so the change can be modest even this close.',
  },
  short_outlet_zero_gradient: {
    title: 'Short domain, zero-gradient outlet',
    what: 'Same short domain, but the outlet imposes ∂u/∂x = 0 and p = 0 instead of the convective, traction-free condition.',
    expect: 'Fixing the pressure where the wake is still far from uniform pins the wrong value just behind the airfoil.',
  },
  narrow_open: {
    title: 'Open sides at ±2c',
    what: 'The open (p = 0, ∂u/∂y = ∂v/∂y = 0) top and bottom boundaries are moved to 2c from the airfoil.',
    expect: 'The far-field pressure is imposed where the airfoil\'s own pressure field has not yet decayed.',
  },
  narrow_slip: {
    title: 'Slip walls at ±2c (a narrow wind tunnel)',
    what: 'Top and bottom become free-slip walls (v = 0, ∂u/∂y = 0) 4c apart: a wind tunnel with no wall boundary layers.',
    expect: 'Blockage: the flow cannot spread sideways, so it accelerates past the airfoil and the walls straighten the streamlines. Wind-tunnel data must be corrected for exactly these effects.',
  },
};
