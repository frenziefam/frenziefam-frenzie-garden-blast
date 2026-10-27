import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
  test: { globals: true, include: ['tests/**/*.test.ts'] },
});
