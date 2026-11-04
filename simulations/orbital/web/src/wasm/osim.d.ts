// Types for the Emscripten module generated from core/bindings/wasm_bindings.cpp.
export interface OsimSimulation {
  init(scenarioJson: string): string;
  step(nodes: number, mode: number): string;
  runUntil(t: number): string;
  action(actionJson: string): string;
  scheduleActions(logJson: string): string;
  history(from: number): Float64Array;
  innovations(from: number): Float64Array;
  summary(): string;
  observability(window: number): string;
  ellipsoid(k: number, confidence: number): string;
  predictTrajectory(horizon: number, points: number): Float64Array;
  particles(max: number): Float64Array;
  actionLog(): string;
  hash(): string;
  historySize(): number;
  innovationSize(): number;
  delete(): void;
}

export interface OsimModule {
  Simulation: new () => OsimSimulation;
  chi2Quantile(p: number, k: number): number;
  listEstimators(): string;
  listSensors(): string;
}

export type CreateOsimModule = (opts?: { locateFile?: (path: string) => string }) => Promise<OsimModule>;
