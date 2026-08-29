import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/vite-env.d.ts', 'src/main.ts'],
      thresholds: {
        statements: 85,
        branches: 79,
        functions: 85,
        lines: 85,
      },
    },
  },
});
