import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/db/**/*.ts', 'src/lib/**/*.ts', 'src/services/**/*.ts', 'src/handlers/**/*.ts', 'src/lambdas/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', 'src/lib/honoTypes.ts', 'src/lambdas/api.ts', 'src/lambdas/local.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
