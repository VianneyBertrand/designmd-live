import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // In a published CLI the panel is mounted under /__designmd-live/.
  // In Vite dev (local panel-only iteration) we keep base at /.
  base: command === 'build' ? '/__designmd-live/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3030',
    },
  },
}));
