import { defineConfig } from 'tsdown';

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
  // Preserve the shebang on cli.ts so `dist/cli.js` is directly executable
  // when symlinked through the `bin` field. tsdown keeps the shebang on
  // entries that already have one.
});
