// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/', '**/coverage/', 'database/migrations/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    ...reactHooks.configs.flat.recommended,
    files: ['frontend/**/*.{ts,tsx}'],
  },
  {
    rules: {
      // DreamLand §5: use the logger, never console.*
      'no-console': 'error',
      eqeqeq: 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Allow intentionally unused parameters such as Express's `_next`
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
]);
