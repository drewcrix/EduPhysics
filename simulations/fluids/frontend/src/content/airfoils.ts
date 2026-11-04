/**
 * Educational text for each section. Geometric numbers shown next to this text come from the
 * manifest (computed by the backend from the NACA equations), not from here.
 */
export interface AirfoilText {
  tagline: string;
  naming: string;
  character: string;
}

export const airfoilText: Record<string, AirfoilText> = {
  '0012': {
    tagline: 'Symmetric, 12% thick',
    naming: 'NACA 4-digit "0012": 0% camber (first digit), camber position not applicable (second digit 0), and 12% maximum thickness (last two digits), which NACA sections reach at 30% of the chord.',
    character: 'With no camber the upper and lower surfaces are mirror images, so the section produces no lift at α = 0 and thin-airfoil theory predicts no pitching moment about the quarter chord at any angle. It is the standard reference shape for experiments and CFD validation, and is used where lift is needed in both directions, such as tail surfaces and rotor blades.',
  },
  '2412': {
    tagline: '2% camber at 40% chord, 12% thick',
    naming: 'NACA 4-digit "2412": maximum camber 2% of the chord, located at 40% chord, with 12% thickness.',
    character: 'Camber curves the mean line, so the section already lifts at α = 0; its zero-lift angle is about −2° and the lift curve is shifted upwards relative to the NACA 0012. Camber placed at 40% chord loads the rear of the section and gives a nose-down moment (C_m,c/4 ≈ −0.05 in thin-airfoil theory). A widely used general-aviation wing section.',
  },
  '23012': {
    tagline: '5-digit, forward camber, 12% thick',
    naming: 'NACA 5-digit "23012": the first digit gives a design lift coefficient of 0.3 (2 × 0.15), the second places the maximum camber near 15% chord (3 × 5%), the third (0) a standard, non-reflexed mean line, and the last two 12% thickness. The maximum camber is about 1.8%.',
    character: 'The 5-digit mean line puts its curvature far forward and is nearly straight behind it. Forward camber reduces the nose-down pitching moment (C_m,c/4 ≈ −0.01 in theory) compared with the 2412. At high Reynolds numbers the 230-series is known for a high maximum lift but an abrupt leading-edge stall; at the low Reynolds numbers here the viscous behaviour is different and is what the simulations show.',
  },
  '2213': {
    tagline: '2% camber at 20% chord, 13% thick',
    naming: 'NACA 4-digit "2213": maximum camber 2% at 20% chord, with 13% thickness.',
    character: 'Same camber as the 2412, but placed further forward and on a slightly thicker section. Moving the camber forward reduces the zero-lift angle magnitude and the nose-down moment relative to the 2412; the extra thickness gives a larger leading-edge radius (r ∝ t²), which softens the suction peak at the nose.',
  },
};

export const camberPrimer =
  'The camber line (dashed) is the curve halfway between upper and lower surfaces; camber is its greatest distance from the chord line. Thickness is added perpendicular to the camber line. Camber mainly sets the zero-lift angle and pitching moment; thickness mainly affects the pressure distribution near the nose, the leading-edge radius and, in real (viscous) flow, drag and stall.';
