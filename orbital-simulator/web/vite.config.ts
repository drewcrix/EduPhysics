import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Content (lessons, rules, bot dialogue) and scenarios live outside web/ so that authors
// and the C++ tests share one source of truth.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@content': r('../content'),
      '@scenarios': r('../scenarios'),
    },
  },
  server: { fs: { allow: [r('..')] } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber'],
          markdown: ['react-markdown', 'remark-math', 'rehype-katex', 'katex'],
          charts: ['uplot'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
