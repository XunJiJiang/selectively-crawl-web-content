import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import scwcVite from '@scwc/vite-plugin';

const directory = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: path.join(directory, 'web'),
  // 使用目录名而不是 package.name；复制或重命名模板后资源地址仍正确。
  base: `/web/page/plugin/${encodeURIComponent(path.basename(directory))}/`,
  plugins: [scwcVite()],
  cacheDir: path.join(directory, 'node_modules/.vite'),
  build: { outDir: 'dist', emptyOutDir: true },
});
