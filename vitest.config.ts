import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.*', 'tests/**/*.test.*', 'src/**/*.{test,spec}.*'],
    environment: 'node',
    testTimeout: 30000,
  },
});
