// Single ESLint config for the whole repository (frontend + backend).
// Goal: catch real bugs (unused vars, undefined names, unsafe patterns) and
// keep files small. Formatting is Prettier's job, so stylistic rules are off.
import js from '@eslint/js';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const sizeRules = {
  // Large files are hard to review; new code should stay well below this.
  'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**', 'dist/**', 'dist-*/**', 'coverage/**',
      'src/i18n/locales/**', 'backend/coverage/**', '**/*.d.ts',
    ],
  },

  // ---- Frontend (Vue 3 + TypeScript) ----
  {
    files: ['src/**/*.{js,ts,vue}', 'tests/**/*.{js,ts,mjs}', '*.config.{js,ts}', 'scripts/**/*.mjs'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, ...pluginVue.configs['flat/essential']],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
    rules: {
      ...sizeRules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'vue/multi-word-component-names': 'off',
      // Vuetify slot names contain dots (`#item.actions`).
      'vue/valid-v-slot': ['error', { allowModifiers: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The logic layer is strict TypeScript: no escape hatches.
    files: ['src/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['tests/**'],
    languageOptions: { globals: { ...globals.vitest } },
    rules: { 'max-lines': 'off', 'no-console': 'off' },
  },
  {
    // Command-line tools report progress on stdout.
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },

  // ---- Backend (Node.js, CommonJS) ----
  {
    files: ['backend/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...sizeRules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$|^req$|^res$', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['backend/test/**', 'backend/testSupport/**', 'backend/scripts/**'],
    rules: { 'max-lines': 'off' },
  },

  prettier,
);
