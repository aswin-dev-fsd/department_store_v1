import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin /api in development, as Vercel's rewrite does in staging (Task 1.10),
    // so the session cookie behaves identically everywhere
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
