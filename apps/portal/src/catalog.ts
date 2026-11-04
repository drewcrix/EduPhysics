/**
 * The simulator catalogue. Adding a simulator to the platform = one entry here (plus its build
 * step in scripts/build-site.mjs); the landing page renders whatever is listed.
 */
export type Status = 'available' | 'planned';

export interface Simulator {
  id: string;
  title: string;
  subject: string;
  summary: string;
  /** Relative to the portal, so the site works at any base path. */
  href: string;
  status: Status;
  level: string;
  topics: string[];
  /** One honest sentence on how the numbers are produced. */
  engine: string;
  accent: 'cyan' | 'amber' | 'teal' | 'violet';
}

export const simulators: Simulator[] = [
  {
    id: 'orbital',
    title: 'Mission Control Academy',
    subject: 'Orbit determination & state estimation',
    summary:
      'Fly missions as a flight-dynamics operator: choose sensors and filters, read the innovations, and see how uncertainty grows, shrinks and sometimes lies.',
    href: './orbital/',
    status: 'available',
    level: 'Undergraduate engineering',
    topics: ['Kalman filters (EKF, UKF, particle filter)', 'Two-body orbital dynamics', 'Observability', 'Uncertainty calibration'],
    engine: 'C++20 dynamics and estimators compiled to WebAssembly, running live in your browser.',
    accent: 'cyan',
  },
  {
    id: 'fluids',
    title: 'Airfoil Flow Lab',
    subject: 'Low-Reynolds-number aerodynamics',
    summary:
      'Explore viscous flow around NACA airfoils at Re = 100–2000: pressure and skin friction, boundary layers, separation, vortex shedding, and where thin-airfoil theory stops working.',
    href: './fluids/',
    status: 'available',
    level: 'Undergraduate engineering, with advanced notes',
    topics: ['Incompressible Navier–Stokes', 'Boundary layers & separation', 'Lift, drag & pitching moment', 'Thin-airfoil theory', 'High-lift devices'],
    engine: 'A Python cut-cell Navier–Stokes solver; every case is computed offline and loaded instantly.',
    accent: 'amber',
  },
];

export const available = () => simulators.filter((s) => s.status === 'available');
