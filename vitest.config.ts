import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      // Thresholds guard the logic layer (services, i18n, theme, routing,
      // configuration). Pages and components are covered end to end by
      // tests/e2e/* (Playwright) rather than by unit tests.
      include: ['src/services/**', 'src/store/**', 'src/i18n/*.ts', 'src/theme/**', 'src/router/**', 'src/config/**'],
      thresholds: { lines: 85, statements: 82, functions: 77, branches: 75 },
    },
    // Vuetify ships CSS imports inside its ESM build; let Vite transform it.
    server: { deps: { inline: ['vuetify'] } },
  },
});
