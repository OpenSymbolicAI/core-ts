import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'examples/**/*.test.ts'],
  },
  esbuild: {
    target: 'es2022',
  },
});
