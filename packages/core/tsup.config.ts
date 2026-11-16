import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    minify: false,
  },
  {
    entry: { 'dom-blame': 'src/auto.ts' },
    format: ['iife'],
    globalName: 'DomBlame',
    dts: false,
    sourcemap: false,
    clean: false,
    target: 'es2020',
    minify: true,
    outExtension() {
      return { js: '.iife.js' };
    },
  },
]);
