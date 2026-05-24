import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // Preserve the shebang so `dist/cli.js` is directly executable when symlinked
  // through `bin`. tsup keeps it by default for files that already have one.
  shims: false,
});
