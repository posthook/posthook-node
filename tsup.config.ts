import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  define: {
    __SDK_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
});
