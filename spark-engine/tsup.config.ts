import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'events/index': 'src/events/index.ts',
    'cli/main': 'src/cli/main.ts',
    'tui/index': 'src/tui/index.tsx',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
