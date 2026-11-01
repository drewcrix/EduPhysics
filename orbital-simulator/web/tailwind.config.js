/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        space: { 950: '#050914', 900: '#0a1226', 850: '#0e1830', 800: '#121f3d', 700: '#1b2b52', 600: '#27407a' },
        signal: { cyan: '#38e1ff', teal: '#2dd4bf', amber: '#fbbf24', rose: '#fb7185', violet: '#a78bfa', lime: '#a3e635' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: { glow: '0 0 24px rgba(56, 225, 255, 0.25)' },
    },
  },
  plugins: [],
};
