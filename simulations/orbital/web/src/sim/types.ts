// Shapes of the JSON returned by the WebAssembly core (see core/bindings/wasm_bindings.cpp).

export type Quantity = 'position' | 'velocity' | 'angle' | 'rate' | 'range' | 'other';

export interface ComponentLabel {
  name: string;
  unit: string;
  quantity: Quantity;
}

export interface SensorMeta {
  id: string;
  name: string;
  type: string;
  dim: number;
  labels: ComponentLabel[];
  enabled: boolean;
  period: number;
  phase: number;
  cost: number;
  outages: [number, number][];
  trueCovariance: number[][];
  assumedCovariance: number[][];
  linear: boolean;
  unsupported: string;
  station?: { name: string; latDeg: number; lonDeg: number; altM: number; minElevationDeg: number };
}

export interface EstimatorInfo {
  type: string;
  name: string;
  summary: string;
  stochastic: boolean;
}

export interface Meta {
  id: string;
  name: string;
  description: string;
  model: 'orbit6' | 'rigid12' | 'cw6';
  epoch: string;
  duration: number;
  dt: number;
  seed: number;
  greenwichAngleAtEpochRad: number;
  mu: number;
  stateLabels: ComponentLabel[];
  controlLabels: ComponentLabel[];
  noiseLabels: ComponentLabel[];
  sensors: SensorMeta[];
  estimator: { type: string; name: string; processNoise: number[][] };
  estimators: EstimatorInfo[];
  impulses: { label: string; t: number; dv: number[]; frame: string; known: boolean }[];
  segments: { label: string; start: number; end: number; thrustN: number; frame: string }[];
  estimatorKnowsThrust: boolean;
  layout: { record: number; stateDim: number; controlDim: number; sensorCount: number; innovation: number; maxMeasDim: number };
}

export interface Status {
  ok: boolean;
  error?: string;
  t: number;
  node: number;
  phase: 'predict' | 'update';
  finished: boolean;
  nextNodeTime: number;
  historySize: number;
  innovationSize: number;
  messages: string[];
}

export interface Summary {
  ok: boolean;
  estimator: { type: string; name: string };
  nodes: number;
  time: number;
  finished: boolean;
  accuracy?: {
    positionRms: number;
    positionRmsTail: number;
    positionFinal: number;
    positionMax: number;
    velocityRms: number;
    velocityFinal: number;
    finalSigmaPosition: number;
    attitudeRmsDeg?: number;
    rateRms?: number;
  };
  calibration?: {
    stateDim: number;
    neesSamples: number;
    anees?: number;
    aneesPerDim?: number;
    aneesBounds95?: [number, number];
    fractionNeesIn95?: number;
    verdict?: 'consistent' | 'overconfident' | 'underconfident';
    anisPerDim?: number;
    fractionNisIn95?: number;
  };
  resources?: { sensors: { id: string; type: string; used: number; cost: number; meanNis?: number; dim?: number }[]; totalCost: number };
  compute?: {
    dynamicsEvaluations: number;
    jacobianEvaluations: number;
    predictMs: number;
    updateMs: number;
    particles: number;
    ess: number;
    resamples: number;
    collapses: number;
    degeneracyFallbacks: number;
    psdRepairs: number;
  };
  messages?: string[];
  hash?: string;
}

export interface ObservabilityReport {
  ok: boolean;
  error?: string;
  t0: number;
  window: number;
  stateDim: number;
  rows: number;
  rank: number;
  condition: number | null;
  singularValues: number[];
  bestSigma: (number | null)[];
  unobservable: boolean[];
  weakDirections: string[];
  notes: string[];
}

export interface EllipsoidReport {
  ok: boolean;
  center: number[];
  semiAxes: number[];
  axes: number[][];
  k2: number;
  confidence: number;
}

/** Sensor availability codes (SensorStatus in simulation.hpp). */
export const SENSOR_STATUS = ['no-sample', 'used', 'disabled', 'outage', 'not-visible', 'unsupported', 'failed'] as const;
export type SensorStatusName = (typeof SENSOR_STATUS)[number];

/** A user action understood by Simulation::apply_action. */
export type SimAction =
  | { type: 'setSensorEnabled'; sensor: string; enabled: boolean }
  | { type: 'setSensorAssumedNoise'; sensor: string; sigma?: number[]; covariance?: number[][] }
  | { type: 'setSensorTrueNoise'; sensor: string; sigma?: number[]; covariance?: number[][] }
  | { type: 'setSensorOutages'; sensor: string; outages: [number, number][] }
  | { type: 'setSensorPeriod'; sensor: string; period: number }
  | { type: 'setProcessNoise'; psd?: number[]; covariance?: number[][] }
  | { type: 'addImpulse'; impulse: { t: number; dv: number[]; frame?: string; known?: boolean; label?: string; assumedSigma?: number[] } }
  | { type: 'addThrustSegment'; segment: Record<string, unknown> }
  | { type: 'setEstimatorKnowsThrust'; value: boolean }
  | { type: 'switchEstimator'; estimator: string; pf?: Record<string, unknown>; ukf?: Record<string, unknown>; kf?: Record<string, unknown> };
