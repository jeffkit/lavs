import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Allow resolving .ts files from extensionless imports
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
