import type { ReactNode } from 'react';
import type { Manifest } from '../data/types';
import { hrefFor } from '../hooks/useRoute';
import { boundaryLayerThickness } from '../physics/theory';
import { Tex } from '../components/Tex';
import { SourceTag } from '../components/Badge';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="panel scroll-mt-20 p-5" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="font-display text-xl font-semibold text-slate-100">{title}</h2>
      <div className="prose-theory mt-3 space-y-3 text-[14px] leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

function Advanced({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-signal-violet/25 bg-signal-violet/5 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-signal-violet">Advanced: {title}</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

function TryIt({ airfoil, re, aoa, view = 'speed', children }: { airfoil: string; re: number; aoa: number; view?: string; children: ReactNode }) {
  return (
    <a className="inline-flex items-center gap-1 rounded-md border border-signal-cyan/30 bg-signal-cyan/10 px-2 py-0.5 text-xs text-signal-cyan hover:bg-signal-cyan/20"
      href={hrefFor('simulator', { airfoil, re, aoa, view })}>▶ {children}</a>
  );
}

const TOC: [string, string][] = [
  ['equations', 'Governing equations'], ['reynolds', 'Reynolds number and viscosity'], ['boundary-layers', 'Boundary layers and separation'],
  ['lift', 'Pressure, circulation and lift'], ['kutta', 'The Kutta condition'], ['stagnation', 'Stagnation points'],
  ['thin-airfoil', 'Thin-airfoil theory'], ['stall', 'Stall'], ['coefficients', 'Aerodynamic coefficients'], ['numerics', 'How the results were computed'],
];

export function TheoryPage({ manifest }: { manifest: Manifest }) {
  const res = manifest.reynolds.length ? manifest.reynolds : [100, 200, 500, 1000];
  const hi = res[res.length - 1];
  const lo = res[0];
  const v = manifest.validation;
  return (
    <div className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:p-6">
      <nav aria-label="Theory sections" className="lg:sticky lg:top-4 lg:self-start">
        <ol className="panel space-y-1 p-3 text-sm">
          {TOC.map(([id, title], i) => <li key={id}><a className="text-slate-300 hover:text-signal-cyan" href={`#/theory/${id}`}>{i + 1}. {title}</a></li>)}
        </ol>
      </nav>
      <div className="min-w-0 space-y-5">
        <Section id="equations" title="1 · Governing equations">
          <p>The simulator solves the two-dimensional, incompressible Navier–Stokes equations: conservation of momentum and of mass for a fluid of constant density <Tex>{'\\rho'}</Tex> and dynamic viscosity <Tex>{'\\mu'}</Tex> (kinematic viscosity <Tex>{'\\nu = \\mu/\\rho'}</Tex>).</p>
          <Tex display>{'\\rho\\left(\\frac{\\partial \\mathbf u}{\\partial t} + (\\mathbf u\\cdot\\nabla)\\mathbf u\\right) = -\\nabla p + \\mu\\nabla^2\\mathbf u, \\qquad \\nabla\\cdot\\mathbf u = 0'}</Tex>
          <p>Measuring lengths in chords <Tex>c</Tex>, velocities in units of the free-stream speed <Tex>{'U_\\infty'}</Tex>, time in <Tex>{'c/U_\\infty'}</Tex> and pressure in <Tex>{'\\rho U_\\infty^2'}</Tex> leaves a single parameter, the Reynolds number. In components:</p>
          <Tex display>{'\\begin{aligned}\\underbrace{\\frac{\\partial u}{\\partial t}}_{\\text{local}} + \\underbrace{u\\frac{\\partial u}{\\partial x} + v\\frac{\\partial u}{\\partial y}}_{\\text{convective}} &= \\underbrace{-\\frac{\\partial p}{\\partial x}}_{\\text{pressure}} + \\underbrace{\\frac{1}{Re}\\left(\\frac{\\partial^2 u}{\\partial x^2} + \\frac{\\partial^2 u}{\\partial y^2}\\right)}_{\\text{viscous}}\\\\ \\frac{\\partial v}{\\partial t} + u\\frac{\\partial v}{\\partial x} + v\\frac{\\partial v}{\\partial y} &= -\\frac{\\partial p}{\\partial y} + \\frac{1}{Re}\\left(\\frac{\\partial^2 v}{\\partial x^2} + \\frac{\\partial^2 v}{\\partial y^2}\\right)\\\\ \\frac{\\partial u}{\\partial x} + \\frac{\\partial v}{\\partial y} &= 0, \\qquad Re = \\frac{U_\\infty c}{\\nu}\\end{aligned}'}</Tex>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Local acceleration</b> <Tex>{'\\partial\\mathbf u/\\partial t'}</Tex>: change of velocity at a fixed point. Zero in a steady flow, essential for vortex shedding.</li>
            <li><b>Convective acceleration</b> <Tex>{'(\\mathbf u\\cdot\\nabla)\\mathbf u'}</Tex>: a fluid particle speeds up or turns as it moves to where the velocity is different. It is the nonlinear term, the source of inertia-dominated behaviour and of instability.</li>
            <li><b>Pressure gradient</b> <Tex>{'-\\nabla p'}</Tex>: fluid is pushed from high towards low pressure. In incompressible flow pressure is not set by an equation of state: it takes whatever value keeps <Tex>{'\\nabla\\cdot\\mathbf u = 0'}</Tex>. Taking the divergence of the momentum equation gives a Poisson equation, <Tex>{'\\nabla^2 p = 2(u_x v_y - u_y v_x)'}</Tex> in 2D, so pressure responds instantly to the whole flow.</li>
            <li><b>Viscous diffusion</b> <Tex>{'Re^{-1}\\nabla^2\\mathbf u'}</Tex>: momentum spreads between neighbouring layers of fluid by molecular friction. It enforces the no-slip condition at the wall and creates boundary layers.</li>
            <li><b>Continuity</b> <Tex>{'\\nabla\\cdot\\mathbf u = 0'}</Tex>: mass conservation at constant density. What flows into any region flows out.</li>
          </ul>
          <p>At the airfoil surface the fluid sticks to the wall: <Tex>{'u = v = 0'}</Tex>, which combines <b>no penetration</b> (zero normal velocity) and <b>no slip</b> (zero tangential velocity). Far from the airfoil the flow returns to the uniform stream; see <a className="link" href={hrefFor('boundaries')}>Boundary conditions</a>.</p>
          <Advanced title="vorticity transport">
            <p>Taking the curl gives the evolution of the vorticity <Tex>{'\\omega = \\partial v/\\partial x - \\partial u/\\partial y'}</Tex>. In two dimensions there is no vortex stretching:</p>
            <Tex display>{'\\frac{\\partial \\omega}{\\partial t} + (\\mathbf u\\cdot\\nabla)\\omega = \\frac{1}{Re}\\nabla^2\\omega'}</Tex>
            <p>Vorticity is neither created nor destroyed inside the fluid: it is generated at the wall, where no-slip forces a velocity jump, then diffuses outward and is carried downstream. Lift-producing circulation and the wake are both this wall-generated vorticity; switch the field view to <i>Vorticity</i> to see it.</p>
          </Advanced>
        </Section>

        <Section id="reynolds" title="2 · Reynolds number and viscous effects">
          <p>The Reynolds number compares inertial to viscous forces, <Tex>{'Re = \\rho U_\\infty c/\\mu \\sim (\\rho U^2/c)/(\\mu U/c^2)'}</Tex>. Airliner wings operate at <Tex>{'Re \\sim 10^7'}</Tex>; this simulator covers <Tex>{`Re = ${lo}`}</Tex> to <Tex>{`${hi}`}</Tex>, the range of insects and very small flying devices, where viscosity is never negligible.</p>
          <p>A laminar boundary layer on a flat plate grows as <Tex>{'\\delta(x)/x \\approx 5/\\sqrt{Re_x}'}</Tex> (Blasius). At the trailing edge (<Tex>{'x = c'}</Tex>):</p>
          <table className="w-full max-w-md text-sm"><thead><tr className="text-left text-slate-400"><th className="py-1">Re</th><th>δ at the trailing edge</th><th>δ / (12% thickness)</th></tr></thead>
            <tbody>{[...new Set([...res, 2000, 1e6])].sort((a, b) => a - b).map((r) => (
              <tr key={r} className="border-t border-white/5"><td className="py-1 font-mono">{r.toLocaleString('en')}</td><td className="font-mono">{boundaryLayerThickness(r).toFixed(r >= 1e5 ? 4 : 2)} c</td><td className="font-mono">{(boundaryLayerThickness(r) / 0.12).toFixed(r >= 1e5 ? 3 : 1)}</td></tr>
            ))}</tbody></table>
          <p>At these Reynolds numbers the "boundary layer" is as thick as the airfoil or thicker. Consequences visible in the simulator: skin friction is a large share of the drag; viscous layers displace the outer flow and reduce lift below inviscid predictions; the stagnation pressure exceeds the inviscid value; and as Re or α increase the separated flow becomes unsteady and sheds vortices. All flows here are <b>laminar</b>: transition to turbulence on a flat plate needs <Tex>{'Re_x \\sim 5\\times10^5'}</Tex>.</p>
          <p><TryIt airfoil="0012" re={lo} aoa={8}>Low Re: thick viscous layers</TryIt>{' '}<TryIt airfoil="0012" re={hi} aoa={8}>Higher Re: thinner layers</TryIt></p>
        </Section>

        <Section id="boundary-layers" title="3 · Boundary layers and separation">
          <p>Next to the wall, viscosity slows the flow to zero. Outside the viscous layer the flow is nearly inviscid. At the wall itself (<Tex>{'u = v = 0'}</Tex>) the streamwise momentum equation reduces to a statement about the curvature of the velocity profile:</p>
          <Tex display>{'\\mu \\left.\\frac{\\partial^2 u}{\\partial n^2}\\right|_{\\text{wall}} = \\frac{\\partial p}{\\partial s}'}</Tex>
          <p>where <Tex>s</Tex> runs along and <Tex>n</Tex> normal to the surface. In a <b>favourable</b> pressure gradient (<Tex>{'\\partial p/\\partial s < 0'}</Tex>, accelerating outer flow, ahead of the suction peak) the profile is full and stable. In an <b>adverse</b> gradient (<Tex>{'\\partial p/\\partial s > 0'}</Tex>, rising pressure behind the suction peak) the near-wall fluid, which has the least momentum, is decelerated most. If the adverse gradient is strong or long enough the wall shear falls to zero and the flow reverses: the boundary layer <b>separates</b>.</p>
          <p>The skin-friction coefficient <Tex>{'C_f = \\tau_w/(\\tfrac12\\rho U_\\infty^2)'}</Tex> diagnoses this: <Tex>{'C_f = 0'}</Tex> marks separation (and reattachment), <Tex>{'C_f < 0'}</Tex> reversed flow. A separated layer may reattach, enclosing a <b>separation bubble</b>, or stay detached and form a wide wake. At larger α or Re, the separated shear layer rolls up into vortices that are shed periodically; their frequency is reported as a Strouhal number <Tex>{'St = fc/U_\\infty'}</Tex>.</p>
          <p><TryIt airfoil="0012" re={1000} aoa={12} view="vorticity">Separated, unsteady flow</TryIt>{' '}<TryIt airfoil="0012" re={1000} aoa={4}>Attached flow</TryIt></p>
          <Advanced title="Prandtl's boundary-layer equations">
            <p>For <Tex>{'Re \\gg 1'}</Tex>, scaling the wall-normal coordinate by <Tex>{'\\delta \\sim c\\,Re^{-1/2}'}</Tex> reduces the steady equations to</p>
            <Tex display>{'u\\frac{\\partial u}{\\partial x} + v\\frac{\\partial u}{\\partial y} = U_e\\frac{dU_e}{dx} + \\nu\\frac{\\partial^2 u}{\\partial y^2},\\qquad \\frac{\\partial p}{\\partial y} \\approx 0'}</Tex>
            <p>with the outer velocity <Tex>{'U_e(x)'}</Tex> imposed. These equations break down at separation (the Goldstein singularity) and are only rough approximations at <Tex>{'Re \\lesssim 10^3'}</Tex>, where <Tex>{'\\delta'}</Tex> is not small compared with the airfoil. The simulator does not use them: it solves the full Navier–Stokes equations.</p>
          </Advanced>
        </Section>

        <Section id="lift" title="4 · Pressure distribution, circulation and lift">
          <p>The pressure coefficient is <Tex>{'C_p = (p-p_\\infty)/(\\tfrac12\\rho U_\\infty^2)'}</Tex>. Where the flow is inviscid (outside boundary layers and wakes), Bernoulli's equation holds along streamlines that start in the uniform stream, so <Tex>{'C_p = 1 - |\\mathbf u|^2/U_\\infty^2'}</Tex>: fast flow means low pressure. Inside viscous regions total pressure is lost and that relation fails.</p>
          <p>The aerodynamic force is the integral of pressure and wall shear stress over the surface:</p>
          <Tex display>{'\\mathbf F = \\oint \\left(-p\\,\\mathbf n + \\boldsymbol\\tau_w\\right) ds,\\qquad C_L = \\frac{F_y}{\\tfrac12\\rho U_\\infty^2 c},\\quad C_D = \\frac{F_x}{\\tfrac12\\rho U_\\infty^2 c}'}</Tex>
          <p>(per unit span, free stream along <Tex>x</Tex>). Lift comes almost entirely from pressure: low pressure on the upper surface (the suction peak behind the leading edge) and higher pressure underneath. A lifting airfoil has a net <b>circulation</b> <Tex>{'\\Gamma = \\oint \\mathbf u\\cdot d\\mathbf l'}</Tex> around it, and for inviscid flow the <b>Kutta–Joukowski theorem</b> links the two exactly: <Tex>{"L' = \\rho U_\\infty \\Gamma"}</Tex>, with <Tex>{'\\Gamma'}</Tex> measured clockwise for a stream from left to right. The flow is faster over the top <i>because</i> of this circulation; the popular "equal transit time" argument is false, and air over the upper surface in fact arrives at the trailing edge well before the air underneath.</p>
          <p><TryIt airfoil="2412" re={1000} aoa={4} view="pressure">Suction peak and pressure recovery</TryIt></p>
        </Section>

        <Section id="kutta" title="5 · The Kutta condition: ideal theory versus viscous flow">
          <p>Inviscid (potential) flow around an airfoil has a solution for <i>every</i> value of the circulation; theory alone cannot pick the lift. The <b>Kutta condition</b> selects the one value for which the flow leaves the sharp trailing edge smoothly, with finite velocity, instead of whipping around it at infinite speed. For a trailing edge with a finite angle (as here), the trailing edge becomes a stagnation point of the inviscid flow.</p>
          <p>The Kutta condition is a model of viscosity in a theory that has none. In a real (viscous) start-up, flow does initially go around the trailing edge, a strong shear layer forms and rolls up into a <b>starting vortex</b> that is left behind. Kelvin's theorem keeps the total circulation zero, so an equal and opposite circulation remains bound to the airfoil: that is the lift.</p>
          <p>The Navier–Stokes solver imposes <b>no</b> Kutta condition: circulation develops by itself from vorticity generated at the wall and shed at the trailing edge (watch the history plot after the impulsive start). At low Reynolds numbers the thick viscous layers at the trailing edge mean the flow does not leave exactly as inviscid theory assumes; the circulation, and hence lift, is lower than thin-airfoil theory predicts.</p>
        </Section>

        <Section id="stagnation" title="6 · Stagnation points and their movement">
          <p>A stagnation point is a point where the velocity vanishes. In inviscid theory the front stagnation point is where the dividing streamline meets the body; there <Tex>{'C_p = 1'}</Tex>. At zero incidence on a symmetric airfoil it sits exactly at the leading edge. As α increases it moves <b>aft along the lower surface</b>, and the flow above it has to run forward and turn sharply around the nose, which produces the suction peak on the upper surface.</p>
          <p>In viscous flow every wall point has zero velocity, so the stagnation point is identified differently: it is the <b>attachment point</b> where the dividing streamline meets the wall, the wall shear stress changes sign (flow leaves it in both directions), and the surface pressure is close to its maximum. At low Reynolds number viscous stresses raise the peak pressure above the inviscid value, <Tex>{'C_{p,\\max} > 1'}</Tex>. Away from walls, <b>free stagnation points</b> appear where a recirculating region closes; there the velocity field has a saddle. The simulator marks wall attachment (S), separation (Sep), reattachment (R), saddles (×) and eddy centres (◎) computed from the steady or time-averaged flow.</p>
          <p><TryIt airfoil="0012" re={1000} aoa={0} view="pressure">α = 0°: stagnation at the nose</TryIt>{' '}<TryIt airfoil="0012" re={1000} aoa={8} view="pressure">α = 8°: moved onto the lower surface</TryIt></p>
        </Section>

        <Section id="thin-airfoil" title="7 · Thin-airfoil theory and its limits">
          <div><SourceTag kind="theory" /></div>
          <p>Thin-airfoil theory replaces the airfoil by a vortex sheet <Tex>{'\\gamma(x)'}</Tex> along its camber line <Tex>{'z(x)'}</Tex> and requires the camber line to be a streamline of the inviscid flow, with the Kutta condition <Tex>{'\\gamma(c) = 0'}</Tex>. With <Tex>{'x = \\tfrac c2(1-\\cos\\theta)'}</Tex> the solution is a Fourier series whose coefficients depend only on the camber slope:</p>
          <Tex display>{'A_0 = \\alpha - \\frac1\\pi\\int_0^\\pi \\frac{dz}{dx}\\,d\\theta,\\qquad A_n = \\frac2\\pi\\int_0^\\pi \\frac{dz}{dx}\\cos n\\theta\\,d\\theta'}</Tex>
          <Tex display>{'C_L = 2\\pi(\\alpha - \\alpha_{L=0}),\\qquad \\alpha_{L=0} = -\\frac1\\pi\\int_0^\\pi \\frac{dz}{dx}(\\cos\\theta - 1)\\,d\\theta,\\qquad C_{m,c/4} = \\frac\\pi4(A_2 - A_1)'}</Tex>
          <p>The lift slope is <Tex>{'2\\pi'}</Tex> per radian for every thin airfoil; camber only shifts the curve (negative <Tex>{'\\alpha_{L=0}'}</Tex>) and adds a constant nose-down moment about the quarter chord, which is the aerodynamic centre. The values for the four sections here are computed from their exact camber lines:</p>
          <table className="w-full max-w-lg text-sm"><thead><tr className="text-left text-slate-400"><th className="py-1">Section</th><th>α<sub>L=0</sub></th><th>C<sub>m,c/4</sub></th></tr></thead>
            <tbody>{manifest.airfoils.map((a) => <tr key={a.id} className="border-t border-white/5"><td className="py-1">{a.name}</td><td className="font-mono">{a.theory.alpha_l0_deg.toFixed(2)}°</td><td className="font-mono">{a.theory.cm_quarter_chord.toFixed(4)}</td></tr>)}</tbody></table>
          <p><b>Assumptions:</b> inviscid, incompressible, two-dimensional and steady flow; thin sections with small camber (thickness is ignored for lift); small angles of attack; attached flow everywhere; the Kutta condition at a sharp trailing edge.</p>
          <p><b>What it cannot predict:</b> any drag (inviscid flow exerts none on a 2D body: d'Alembert's paradox); separation, stall or a maximum lift; any effect of Reynolds number; and the effect of thickness on the pressure distribution. At the Reynolds numbers of this simulator the CFD lift slope is well below <Tex>{'2\\pi'}</Tex> and the curves bend as separation grows; compare them on the lift-curve plot. At high Reynolds numbers and small angles, measured lift slopes come much closer to <Tex>{'2\\pi'}</Tex>, which is why the theory remains central to aerodynamics.</p>
        </Section>

        <Section id="stall" title="8 · Stall">
          <p>Stall is the loss of lift growth, and eventually of lift, when the flow separates over much of the upper surface. At high Reynolds numbers airfoils show distinct types: <b>trailing-edge stall</b> (separation creeping forward from the trailing edge; gradual, typical of thicker sections), <b>leading-edge stall</b> (a short separation bubble near the nose suddenly bursts; abrupt) and <b>thin-airfoil stall</b> (a long bubble that grows with α).</p>
          <p>The laminar, two-dimensional flows at <Tex>{`Re \\le ${hi}`}</Tex> behave differently. Separation sets in gradually and the separated flow becomes unsteady and sheds vortices. At the lowest Reynolds numbers the lift curve just bends over; at higher ones it flattens when separation starts and can then steepen again, because vortices forming over the upper surface raise the time-averaged suction. The simulator therefore reports a lift maximum <b>only</b> where the computed points show one (the largest mean <Tex>{'C_L'}</Tex> lies inside the computed range and the next angle is clearly lower), and otherwise says that no stall angle can be identified. Real flows at these conditions with large separation are also three-dimensional, which a 2D simulation cannot capture.</p>
          <p><TryIt airfoil="0012" re={1000} aoa={20} view="vorticity">High angle of attack</TryIt></p>
        </Section>

        <Section id="coefficients" title="9 · Aerodynamic coefficients">
          <ul className="list-disc space-y-1 pl-5">
            <li><Tex>{'C_L, C_D'}</Tex>: force normal and parallel to the free stream per unit span, divided by <Tex>{'\\tfrac12\\rho U_\\infty^2 c'}</Tex>.</li>
            <li><Tex>{'C_D = C_{D,f} + C_{D,p}'}</Tex>: skin friction (integral of wall shear) plus pressure or form drag (streamwise pressure force, large when the wake is wide).</li>
            <li><Tex>{'C_{m,c/4} = M/(\\tfrac12\\rho U_\\infty^2 c^2)'}</Tex>: pitching moment about the quarter chord, positive nose up.</li>
            <li><Tex>{'L/D = C_L/C_D'}</Tex>: aerodynamic efficiency. Viscous drag keeps it low at these Reynolds numbers (single digits, compared with around 100 for a good airfoil at high Re).</li>
            <li>For unsteady flows all coefficients are time averages over the final 12 convective times; the plots show the oscillation range.</li>
          </ul>
        </Section>

        <Section id="numerics" title="10 · How the results were computed, and their limits">
          <div><SourceTag kind="cfd" /></div>
          <p>Each case is an impulsively started simulation run offline with a Python finite-volume solver: a staggered Cartesian grid stretched away from the airfoil, a sharp cut-cell representation of the surface (no-slip and no-penetration imposed at the exact wall position), second-order upwind convection, implicit diffusion and a projection step that makes the velocity field exactly divergence free. Forces come from pressure and shear evaluated just off the wall. Steady cases are run to convergence; unsteady cases to <Tex>{'t = 32\\,c/U_\\infty'}</Tex> and averaged over the last 12 time units.</p>
          {v?.grid_study && (
            <p>Grid sensitivity (NACA 0012): {v.grid_study.map((r) => `${r.level} grid ${r.cells.toLocaleString('en')} cells, Re ${r.reynolds}, α ${r.aoa_deg}°: C_L ${r.cl.toFixed(4)}, C_D ${r.cd.toFixed(4)}`).join('; ')}.</p>
          )}
          {v?.cylinder && (
            <p>Validation, circular cylinder: {v.cylinder.map((r) => `Re ${r.reynolds}: C_D ${r.cd.toFixed(3)}, recirculation length ${r.recirculation_length?.toFixed(2)} D, separation angle ${r.separation_angle_deg?.toFixed(1)}° (${Object.values(r.passed).every(Boolean) ? 'within' : 'outside'} the published range)`).join('; ')}.</p>
          )}
          <p><b>Limitations.</b> Two-dimensional, laminar, incompressible flow only; no turbulence and no three-dimensional instabilities, both of which matter in real separated flows at the upper end of this Reynolds range. Results carry discretisation errors of the order of a few per cent (see IMPLEMENTATION.md for the grid study). Unsteady averages depend on the length of the averaging window. Cases still drifting at the end of the run are labelled <i>not converged</i>. Configurations outside the computed set are simply not offered.</p>
        </Section>
      </div>
    </div>
  );
}
