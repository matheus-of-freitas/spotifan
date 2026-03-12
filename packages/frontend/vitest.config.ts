import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      exclude: ['src/main.tsx', 'src/routeTree.gen.ts', 'src/test/**', '**/*.config.*', 'dist/**'],
    },
  },
});
