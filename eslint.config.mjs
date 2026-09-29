import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'docs/**'],
  },

  // TypeScript: packages/ + examples/ (type safety is enforced by `tsc`; this
  // layer is non-type-aware lint only).
  {
    files: ['packages/**/*.ts', 'examples/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Browser JS: Chrome extension (MV3 contexts) + the demo viewer module.
  {
    files: ['extension/**/*.js', 'demo/**/*.js'],
    extends: [js.configs.recommended, prettier],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        chrome: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Node-side scripts (schema validator, benchmarks, this config).
  {
    files: [
      'schema/**/*.mjs',
      'benchmarks/**/*.mjs',
      'extension/.harness/*.mjs', // node-side harness drivers (generator, puppeteer runner)
      'demo/**/*.mjs', // demo manifest builders, server, validator
      '*.mjs',
    ],
    extends: [js.configs.recommended, prettier],
    languageOptions: {
      sourceType: 'module',
      globals: globals.node,
    },
  },
);
