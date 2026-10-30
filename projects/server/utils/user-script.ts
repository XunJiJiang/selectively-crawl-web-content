import { access } from 'node:fs/promises';
import path from 'node:path';
import open from 'open';
import { HOST, ACTIVE_PORT } from '../common/env.ts';
import { ROOT, SERVER_ROOT, isPackaged } from '../common/paths.ts';

export const userScriptPath = isPackaged
  ? path.join(SERVER_ROOT, 'public/userscript/scwc.user.js')
  : path.join(ROOT, 'dist/user-script/scwc.user.js');

export function userScriptUrl(host = HOST, port = ACTIVE_PORT) {
  const url = new URL(host);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('核心地址必须使用 HTTP 或 HTTPS');
  }
  if (['0.0.0.0', '[::]', '::'].includes(url.hostname)) {
    url.hostname = 'localhost';
  }
  url.port = String(port);
  url.username = '';
  url.password = '';
  url.pathname = '/web/userscript/scwc.user.js';
  url.search = '';
  url.hash = '';
  return url.href;
}

export async function requireUserScript() {
  try {
    await access(userScriptPath);
  } catch {
    throw new Error(
      '油猴脚本产物不存在，请先在仓库运行 bun run --cwd projects/user-script build；发行包请重新构建。',
    );
  }
}

export async function notifyUserScriptFailure(message: string) {
  const { createNotificationLogger } = await import('../workbench/notifications.ts');
  await createNotificationLogger({ source: 'core', pluginId: null }).error('油猴脚本安装唤起失败', {
    message,
  });
}

/** 系统启动器的成功仅代表已提交链接，扩展是否接管、用户是否确认均没有可靠回执。 */
export async function openUserScriptInstaller() {
  await requireUserScript();
  const url = userScriptUrl();
  try {
    const child = await open(url, { wait: false });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let handoffReturned = false;
      let lateFailureReported = false;
      const finish = (error?: Error) => {
        if (settled) {
          if (error && handoffReturned && !lateFailureReported) {
            lateFailureReported = true;
            void notifyUserScriptFailure(error.message).catch(() => undefined);
          }
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const timer = setTimeout(() => {
        handoffReturned = true;
        finish();
      }, 1000);
      child.once('error', (error) => finish(error));
      child.once('close', (code, signal) =>
        finish(code === 0 ? undefined : new Error(`系统启动器退出：${signal ?? code}`)),
      );
      if (child.exitCode !== null) {
        finish(child.exitCode === 0 ? undefined : new Error(`系统启动器退出：${child.exitCode}`));
      }
    });
  } catch (error) {
    throw new Error(
      `无法在默认浏览器唤起油猴脚本安装：${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
  return {
    url,
    message:
      '已向默认浏览器发送安装请求，请在油猴中确认安装。若显示源码或下载文件，请先安装并启用 Tampermonkey，再重试；当前无法确认扩展是否接管。',
  };
}
