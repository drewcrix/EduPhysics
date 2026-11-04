import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' keeps every asset URL relative, so the portal works at the site root or under any
// sub-path (GitHub Pages project sites included).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
});
