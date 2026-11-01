// Copy the Emscripten build output into the web app (src/wasm/generated/).
// Build it first with:  cmake --preset wasm && cmake --build --preset wasm   (from orbital-simulator/)
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../build/wasm/core');
const dst = resolve(here, '../src/wasm/generated');
mkdirSync(dst, { recursive: true });
let missing = false;
for (const f of ['osim.mjs', 'osim.wasm']) {
  if (!existsSync(`${src}/${f}`)) {
    missing = true;
    continue;
  }
  copyFileSync(`${src}/${f}`, `${dst}/${f}`);
}
// Type declaration for the generated ES module (types live in src/wasm/osim.d.ts)
writeFileSync(`${dst}/osim.d.mts`, "import type { CreateOsimModule } from '../osim';\ndeclare const createOsimModule: CreateOsimModule;\nexport default createOsimModule;\n");
if (missing) {
  if (existsSync(`${dst}/osim.mjs`) && existsSync(`${dst}/osim.wasm`)) {
    console.warn('[wasm:copy] build/wasm not found; using the previously copied module.');
  } else {
    console.error('[wasm:copy] WebAssembly module missing. Build it with: cmake --preset wasm && cmake --build --preset wasm');
    process.exit(1);
  }
} else {
  console.log(`[wasm:copy] copied osim.mjs + osim.wasm -> ${dst}`);
}
