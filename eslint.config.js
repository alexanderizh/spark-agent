/**
 * ESLint 扁平配置（Flat Config）— 项目级
 *
 * 适用于所有 workspace 包（apps/desktop、packages/*）。
 * 各包可覆盖或扩展此配置。
 */

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  // 基础推荐规则
  js.configs.recommended,

  // TypeScript 推荐规则
  ...tseslint.configs.recommended,

  // 全局忽略
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      '**/.electron-vite/**',
      '**/coverage/**',
      '**/out/**',
    ],
  },

  // TypeScript 文件通用规则
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // TypeScript 严格规则
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',

      // 通用规则
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Node 22 ESM tool servers run outside the browser. ESLint's base JavaScript
  // config does not infer those runtime globals for .mjs files.
  {
    files: ['packages/agent-runtime/src/tools/**/*.mjs'],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        Buffer: 'readonly',
        URLSearchParams: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },

  // React 组件文件 — 仅限 apps/desktop（主应用）
  {
    files: ['apps/desktop/src/**/*.tsx', 'apps/desktop/src/**/*.jsx'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Hooks 7 folds React Compiler adoption diagnostics into the
      // recommended preset. Keep them visible while the existing UI is
      // migrated incrementally instead of turning the whole legacy renderer
      // into lint failures. The correctness-critical hook rules stay errors.
      'react-hooks/config': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/gating': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // 测试文件 — 放宽规则
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
