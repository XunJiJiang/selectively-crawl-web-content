import { defineConfig } from 'oxfmt';

export default defineConfig({
  printWidth: 100,
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  tabWidth: 2,
  useTabs: false,
  endOfLine: 'lf',
  arrowParens: 'always',
  bracketSpacing: true,
  sortPackageJson: true,
  ignore: [
    'node_modules/**',
    'dist/**',
    'coverage/**',
    'build/**',
    'release/**',
    'resources/**',
    'pnpm-lock.yaml',
    'package-lock.json',
    '.vite/**',
    '.vscode/**',
  ],
  include: ['**/*.ts'],
});
