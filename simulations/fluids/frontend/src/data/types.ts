/**
 * Types of the dataset written by the Python backend (eduphysics_fluids/datagen.py).
 * Field names follow the JSON exactly; see simulations/fluids/IMPLEMENTATION.md for the schema.
 */

/** How a run ended. Only "steady" and "nearly_steady" are steady flows; see datagen.classify_flow. */
export type FlowClass = 'steady' | 'nearly_steady' | 'periodic' | 'irregular' | 'not_converged';

export interface ThinAirfoil {
  alpha_l0_deg: number;
  lift_slope_per_rad: number;
  cm_quarter_chord: number;
}

export interface AirfoilInfo {
  id: string;
  name: string;
  family: '4-digit' | '5-digit';
  thickness_ratio: number;
  max_thickness_x: number;
  max_camber: number;
  max_camber_x: number | null;
  leading_edge_radius: number;
  theory: ThinAirfoil;
  /** Chord frame, closed outline TE -> upper -> LE -> lower -> TE. */
  outline: { x: number[]; y: number[] };
  camber_line: { x: number[]; y: number[] };
}

export interface CaseSummary {
  id: string;
  airfoil: string;
  reynolds: number;
  aoa_deg: number;
  variant: string;
  class: FlowClass;
  cl: number;
  cd: number;
  cm: number;
  cd_pressure: number;
  cd_friction: number;
  strouhal: number | null;
  stagnation_x: number | null;
  stagnation_upper: boolean | null;
  separation_x: number | null;
  cl_min?: number;
  cl_max?: number;
  cd_min?: number;
  cd_max?: number;
}

export interface DomainVariant {
  upstream: number;
  downstream: number;
  lateral: number;
  wall_spacing: number;
  chord_spacing: number;
  growth: number;
  lateral_bc: 'open' | 'slip';
  outlet_bc: 'convective' | 'zero_gradient';
}

export interface CylinderValidation {
  reynolds: number;
  cd: number;
  recirculation_length: number | null;
  separation_angle_deg: number | null;
  cp_front: number;
  steady: boolean;
  passed: Record<string, boolean>;
}

export interface GridStudyRow {
  level: string;
  reynolds: number;
  aoa_deg: number;
  cells: number;
  cl: number;
  cd: number;
}

export interface Validation {
  cylinder?: CylinderValidation[];
  symmetry?: { lift_asymmetry: number; drag_asymmetry: number };
  grid_study?: GridStudyRow[];
}

export interface Manifest {
  schema: number;
  generated_at: string;
  airfoils: AirfoilInfo[];
  reynolds: number[];
  angles: Record<string, number[]>;
  bc_explorer: { airfoil: string; reynolds: number; aoa: number; variants: Record<string, DomainVariant> };
  grids: Record<string, { wall_spacing: number; chord_spacing: number; growth: number; upstream: number; downstream: number; lateral: number }>;
  field_window: { x0: number; x1: number; y0: number; y1: number; spacing: number };
  cases: CaseSummary[];
  validation?: Validation;
}

export type WallPointKind = 'stagnation' | 'separation' | 'reattachment' | 'attachment' | 'trailing_edge';

export interface WallPoint {
  kind: WallPointKind;
  x: number;
  y: number;
  station: number;
  upper: boolean;
}

export interface FieldPoint {
  kind: 'saddle' | 'vortex' | 'node';
  x: number;
  y: number;
  det: number;
}

export interface FieldMeta {
  file: string;
  encoding: string;
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  spacing: number;
  order: string[];
  states: string[];
  ranges: Record<string, [number, number]>[];
  nan_code: number;
}

export interface CaseRecord {
  schema: number;
  id: string;
  airfoil: string;
  reynolds: number;
  aoa_deg: number;
  variant: string;
  flow: {
    class: FlowClass;
    steady: boolean;
    t_end: number;
    time: number;
    residual: number;
    averaging_window: [number, number] | null;
    strouhal: number | null;
    peak_energy_share: number | null;
  };
  coefficients: {
    cl: number; cd: number; cm: number;
    cl_pressure: number; cl_friction: number; cd_pressure: number; cd_friction: number;
    cl_min?: number; cl_max?: number; cl_rms?: number; cd_min?: number; cd_max?: number; cd_rms?: number;
  };
  theory: ThinAirfoil & { cl_thin_airfoil: number };
  surface: {
    states: string[];
    station: number[];
    upper: number[];
    x: number[];
    y: number[];
    cp: number[][];
    cf: number[][];
  };
  wall_points: WallPoint[];
  field: FieldMeta;
  field_points: FieldPoint[];
  history: { t: number[]; cl: number[]; cd: number[] };
  solver: {
    grid_level: string; nx: number; ny: number; pressure_volumes: number; wall_spacing: number; chord_spacing: number;
    growth: number; upstream: number; downstream: number; lateral: number; lateral_bc: string; outlet_bc: string;
    final_dt: number; steps: number; solve_seconds: number; generated_at: string; average_over: number;
  };
}

/** Decoded flow fields on the uniform grid (row-major, y outermost). NaN inside the airfoil. */
export interface FieldState {
  u: Float32Array;
  v: Float32Array;
  cp: Float32Array;
}

export interface FieldGrid {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  spacing: number;
}

export interface LoadedCase {
  record: CaseRecord;
  grid: FieldGrid;
  /** Same order as record.field.states: ["instantaneous"] or ["instantaneous", "mean"]. */
  fields: FieldState[];
}
