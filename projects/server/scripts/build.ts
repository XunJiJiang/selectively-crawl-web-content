import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'vite';
import webViteConfig from '../../web/vite.config.ts';

const __dirname = import.meta.dirname;
const ROOT = join(__dirname, '..', '..', '..');
const PROJECTS_DIR = join(ROOT, 'projects');
// const WEB_PROJECT_PATH = join(PROJECTS_DIR, 'web');
// const USER_SCRIPT_PROJECT_PATH = join(PROJECTS_DIR, 'user-script');
const SERVER_PROJECT_PATH = join(PROJECTS_DIR, 'server');
const OUT_DIR = join(SERVER_PROJECT_PATH, 'public', 'web');

/** 执行构建 projects/web */
export async function buildWeb() {
  const userScriptViteConfig = webViteConfig({
    mode: 'production',
    command: 'build',
  });
  await build(userScriptViteConfig);
}

/** 非严格判断是否已经构建 */
export function isWebBuilt() {
  const indexHtmlPath = join(OUT_DIR, 'index.html');
  return existsSync(indexHtmlPath);
}

/** 根据模式判断是否需要构建, 只有生产模式且未构建时才需要构建 */
export function shouldBuildWeb(build: boolean, mode: string) {
  if (build) {
    return true;
  }
  return mode === 'prod' && !isWebBuilt();
}

/** 根据参数判断并执行构建 */
export async function buildWebIfNeeded(build: boolean, mode: string) {
  if (shouldBuildWeb(build, mode)) {
    await buildWeb();
  }
}
