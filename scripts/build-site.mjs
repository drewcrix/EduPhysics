#!/usr/bin/env node
// Assemble the EduPhysics static site in dist-site/:
//   dist-site/            portal (apps/portal)
//   dist-site/orbital/    Mission Control Academy (simulations/orbital/web, unchanged build)
//   dist-site/fluids/     Airfoil Flow Lab (simulations/fluids/frontend, with its precomputed data)
//
// Every app is built with relative asset URLs (Vite base './'), so the site works at a domain root
// or under a sub-path such as a GitHub Pages project site.
//
// Options:
//   --orbital-dist <dir>      use an already built orbital web/dist (CI passes the artifact)
//   --skip-orbital-build      reuse simulations/orbital/web/dist from an earlier build. If I added a new orbital feature, you may need to rebuild it (or pass --orbital-dist).
//   --allow-missing-orbital   assemble without the orbital app if it cannot be built (portal link will 404)
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2); // save the command-line arguments for later use such as --orbital-dist and --skip-orbital-build
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const run = (cmd, cwd = root) => { 
  console.log(`\n$ ${cmd}${cwd !== root ? `   (in ${cwd.replace(`${root}/`, '')})` : ''}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

const out = resolve(root, 'dist-site'); // the assembled site
const orbitalWeb = resolve(root, 'simulations/orbital/web'); // the orbital web app (Mission Control Academy) is built from its own source, not from the portal repo

run('npm run build -w @eduphysics/portal');
run('npm run build -w @eduphysics/fluids');

let orbitalDist = option('--orbital-dist') ? resolve(option('--orbital-dist')) : resolve(orbitalWeb, 'dist');
if (!option('--orbital-dist') && !flag('--skip-orbital-build')) {
  try {
    if (!existsSync(resolve(orbitalWeb, 'node_modules'))) run('npm ci', orbitalWeb);
    run('npm run build', orbitalWeb);            // needs the WebAssembly core; see simulations/orbital/README.md
  } catch (error) {
    if (!flag('--allow-missing-orbital')) {
      console.error('\nThe orbital simulator could not be built. Build its WebAssembly core first:\n' +
        '  cd simulations/orbital && cmake --preset wasm && cmake --build --preset wasm\n' +
        'or rerun with --allow-missing-orbital.');
      process.exit(1);
    }
    console.warn('\n[build-site] orbital build failed; continuing without it (--allow-missing-orbital).');
    orbitalDist = null;
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(root, 'apps/portal/dist'), out, { recursive: true });
cpSync(resolve(root, 'simulations/fluids/frontend/dist'), resolve(out, 'fluids'), { recursive: true });
if (orbitalDist && existsSync(resolve(orbitalDist, 'index.html'))) {
  cpSync(orbitalDist, resolve(out, 'orbital'), { recursive: true });
} else if (!flag('--allow-missing-orbital')) {
  console.error(`\nNo orbital build found at ${orbitalDist}.`);
  process.exit(1);
}
writeFileSync(resolve(out, '.nojekyll'), '');   // GitHub Pages: serve files and folders as they are

console.log(`\n[build-site] site assembled in ${out.replace(`${root}/`, '')}/  (preview: npm run preview:site)`);
