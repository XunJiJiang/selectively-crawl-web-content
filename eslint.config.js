// @ts-check

import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import eslintConfigPrettier from 'eslint-config-prettier/flat'

export default defineConfig(
  eslintConfigPrettier,
  {
    ignores: [],
  },
  {
    files: ['**/*.ts'],
    extends: [
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.typescript,
      js.configs.recommended,
      tseslint.configs.strict,
      tseslint.configs.stylistic,
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // 导入必须带文件扩展名
      'import/extensions': [
        'error',
        'always',
        {
          ts: 'always',
          js: 'always',
        },
      ],
    },
  },
  // 浏览器环境全局变量
  {
    files: ['user-script/**/*.ts', 'web/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  // Node.js环境全局变量
  {
    files: ['server/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
)
