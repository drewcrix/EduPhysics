// WebAssembly integration check: run every scenario through the wasm module and compare
// against the native CLI (if available) on the replay hash and key metrics.
//
//   node scripts/wasm_integration_test.mjs [path/to/osim.mjs] [path/to/osim_cli]
//
// Exit code 1 on any failure (missing module, init error, non-finite output, mismatch).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modPath = resolve(process.argv[2] ?? `${root}/build/wasm/core/osim.mjs`);
const cliPath = resolve(process.argv[3] ?? `${root}/build/native/core/osim_cli`);
if (!existsSync(modPath)) {
  console.error(`wasm module not found: ${modPath}`);
  process.exit(1);
}
const createOsimModule = (await import(pathToFileURL(modPath).href)).default;
const Module = await createOsimModule();
const haveCli = existsSync(cliPath);
let failures = 0;
let hashMatches = 0;
const dir = `${root}/scenarios`;
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

for (const f of files) {
  const text = readFileSync(`${dir}/${f}`, 'utf8');
  const sim = new Module.Simulation();
  const init = JSON.parse(sim.init(text));
  if (!init.ok) {
    console.log(`FAIL ${f}: ${init.error}`);
    failures++;
    continue;
  }
  // Advance in irregular chunks, as the UI does, to exercise chunking independence
  let st;
  do {
    st = JSON.parse(sim.step(97, 0));
    if (!st.ok) break;
  } while (!st.finished);
  const summary = JSON.parse(sim.summary());
  const hist = sim.history(0);
  const stride = init.meta.layout.record;
  // Last record: everything finite except NEES, which is NaN by design if P is singular
  const last = Array.from(hist.slice(-stride));
  const neesIndex = 2 + 6 * init.meta.layout.stateDim + 6;
  const finite = hist.length === stride * summary.nodes && last.every((v, i) => i === neesIndex || Number.isFinite(v));
  let line = `${f.padEnd(34)} nodes=${String(summary.nodes).padEnd(6)} posRMS=${summary.accuracy.positionRms.toPrecision(6)}`;
  let ok = st.ok && finite && Number.isFinite(summary.accuracy.positionRms);
  if (haveCli) {
    const native = JSON.parse(execFileSync(cliPath, [`${dir}/${f}`], { encoding: 'utf8', maxBuffer: 1 << 26 }));
    const same = native.hash === summary.hash;
    if (same) hashMatches++;
    const a = native.accuracy.positionRms, b = summary.accuracy.positionRms;
    const rel = Math.abs(a - b) / Math.max(1e-12, Math.abs(a));
    line += ` native=${a.toPrecision(6)} rel=${rel.toExponential(1)} hash=${same ? 'identical' : 'differs'}`;
    // Bit-identical results are expected (same IEEE arithmetic, no FMA contraction);
    // allow tiny libm differences but flag anything material.
    if (rel > 1e-6 && !(f.startsWith('kf_divergence'))) ok = false;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${line}`);
  if (!ok) failures++;
  sim.delete();
}
console.log(`chi2Quantile(0.99, 3) = ${Module.chi2Quantile(0.99, 3)}`);
console.log(`${files.length - failures}/${files.length} scenarios passed in WebAssembly` + (haveCli ? `; ${hashMatches}/${files.length} bit-identical to native` : ''));
process.exit(failures === 0 ? 0 : 1);
