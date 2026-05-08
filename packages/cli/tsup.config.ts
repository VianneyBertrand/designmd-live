import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
    format: ['esm'],
    target: 'node24',
    clean: true,
    dts: false,
    shims: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { agent: 'src/client/agent.ts' },
    outDir: 'dist/client',
    format: ['iife'],
    target: 'es2022',
    clean: false,
    dts: false,
    minify: true,
    outExtension: () => ({ js: '.js' }),
  },
]);
