/** Explicit browser contracts. Root dependencies are not automatically exposed. */
export const sharedBrowserPackages = [
  'lit',
  '@lit/context',
  '@lit-labs/router',
  '@lit-labs/virtualizer',
  'zod',
  'axios',
  'dayjs',
  'es-toolkit',
  'dompurify',
  'marked',
  'sortablejs',
  'uuid',
  'opencc-js',
  '@vscode/codicons',
  'pdfjs-dist',
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/lang-javascript',
  '@codemirror/lang-markdown',
  '@codemirror/lang-yaml',
  '@codemirror/language',
  '@codemirror/legacy-modes',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/html',
  '@lezer/lr',
  '@lezer/markdown',
];

export const vitePluginPackageName = '@scwc/vite-plugin';

/** @param {string} specifier @returns {string | undefined} */
export function packageName(specifier) {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.includes(':')
  ) {
    return;
  }
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}
