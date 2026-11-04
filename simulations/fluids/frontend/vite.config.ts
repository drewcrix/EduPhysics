import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// FLUIDS_DATA_DIR lets you view another dataset (e.g. a test run) without touching data/
const dataDir = process.env.FLUIDS_DATA_DIR ? resolve(process.env.FLUIDS_DATA_DIR) : fileURLToPath(new URL('../data', import.meta.url));

/**
 * The precomputed dataset lives in simulations/fluids/data (written by the Python backend).
 * These plugins serve it at ./data/ during development and copy it into dist/data/ on build,
 * so the backend output never has to be duplicated into the frontend source tree.
 */
function serveData(): Plugin {
  return {
    name: 'eduphysics-fluids-data-serve',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const path = normalize(join(dataDir, decodeURIComponent((req.url ?? '').split('?')[0])));
        if (!path.startsWith(dataDir) || !existsSync(path) || !statSync(path).isFile()) return next();
        res.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : 'application/octet-stream');
        createReadStream(path).pipe(res);
      });
    },
  };
}

function copyData(): Plugin {
  let outDir = 'dist';
  return {
    name: 'eduphysics-fluids-data-copy',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!existsSync(join(dataDir, 'manifest.json'))) {
        this.warn('simulations/fluids/data/manifest.json not found: the build has no flow data.');
        return;
      }
      cpSync(dataDir, join(outDir, 'data'), { recursive: true, filter: (src) => !src.endsWith('.md') });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveData(), copyData()],
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: { katex: ['katex'] } } },
  },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
});
