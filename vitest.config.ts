import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/version.ts'],
    },
  },
  define: {
    __SDK_VERSION__: JSON.stringify('0.0.0-test'),
  },
});
