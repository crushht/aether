import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const baseDirectory = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'dist/**',
      'desktop-build/**',
      'build/**',
      '.data/**',
      '.e2e-data/**',
      '.ci-data/**',
      '.data-dev/**',
      '.data-auth-e2e/**',
      '.improve/**',
      'study/**',
      'scripts/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Electron's main/preload run as CommonJS: require() is the only option.
    files: ['desktop/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['eslint.config.mjs', 'postcss.config.mjs', 'tailwind.config.ts', 'next.config.mjs'],
    rules: {
      'import/no-anonymous-default-export': 'off',
    },
  },
  {
    rules: {
      // the agent streams untyped provider payloads; these catch real bugs, not style
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react/no-unescaped-entities': 'warn',
    },
  },
];

export default config;
