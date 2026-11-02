import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { issueInstallGuide } from './extension-install-guide.ts';
import { APP_DIR, ROOT, isPackaged } from '../common/paths.ts';
import {
  defaultBrowserLaunch,
  detectDefaultBrowser,
  extensionManager,
  type DefaultBrowser,
} from './default-browser.ts';

// 解压扩展的安装路径必须持久；SEA 的私有 runtime 临时目录会在退出时删除。
export const browserExtensionDirectory = isPackaged
  ? path.join(APP_DIR, 'browser-extension')
  : path.join(ROOT, 'dist/browser-extension');
export interface ExtensionInstallResult {
  status: 'opened' | 'unsupported';
  browser: string;
  variant?: 'chromium' | 'firefox';
  directory?: string;
  url?: string;
  managerUrl?: string;
  message: string;
}
export async function notifyBrowserExtensionFailure(message: string) {
  const { createNotificationLogger } = await import('../workbench/notifications.ts');
  await createNotificationLogger({ source: 'core', pluginId: null }).error(
    '浏览器扩展安装唤起失败',
    { message, systemNotification: true },
  );
}
export async function notifyBrowserExtensionUnsupported(message: string) {
  const { createNotificationLogger } = await import('../workbench/notifications.ts');
  await createNotificationLogger({ source: 'core', pluginId: null }).warn(
    '浏览器扩展暂时无法安装',
    { message, systemNotification: true },
  );
}
/** 系统接收启动请求不能证明扩展已经安装；迟到的确定失败另发通知。 */
export function installerHandoff(child: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    let settled = false,
      returned = false,
      reported = false;
    const finish = (error?: Error) => {
      if (settled) {
        if (error && returned && !reported) {
          reported = true;
          void notifyBrowserExtensionFailure(error.message).catch(() => undefined);
        }
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
      } else {
        child.unref();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      returned = true;
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
}
export async function requireBrowserExtension(
  variant: 'chromium' | 'firefox',
  root = browserExtensionDirectory,
) {
  const directory = path.join(root, variant);
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (
      manifest.manifest_version !== 3 ||
      manifest.action?.default_popup !== 'index.html' ||
      (variant === 'firefox' ? !manifest.background?.scripts : !manifest.background?.service_worker)
    ) {
      throw new Error('浏览器扩展清单与目标浏览器不匹配');
    }
    await fs.access(path.join(directory, 'index.html'));
  } catch (error) {
    throw new Error(
      `浏览器扩展产物不可用：${directory}。源码请运行 bun run build:extension；发行包请完整解压并保留 browser-extension 文件夹。`,
      { cause: error },
    );
  }
  return directory;
}
function unsupported(browser: DefaultBrowser): ExtensionInstallResult | undefined {
  if (browser.kind === 'safari') {
    return {
      status: 'unsupported',
      browser: browser.name,
      message:
        '默认浏览器是 Safari。当前发行包仅提供 Safari WebExtension 源包，缺少经过签名的容器应用，无法直接唤起安装。请使用 Chrome、Edge 或 Firefox，或先在 macOS/Xcode 中转换并签名 Safari 应用。',
    };
  }
  if (browser.kind === 'unknown') {
    return {
      status: 'unsupported',
      browser: browser.name,
      message: `无法确认默认浏览器 ${browser.name} 支持哪种扩展包，未选择或启动其他浏览器。请将 Chrome、Edge 或 Firefox 设为默认浏览器后重试。`,
    };
  }
}
export async function openBrowserExtensionInstaller(): Promise<ExtensionInstallResult> {
  let browser: DefaultBrowser;
  try {
    browser = await detectDefaultBrowser();
  } catch (error) {
    throw new Error('无法识别当前系统的默认浏览器，请检查默认 HTTP 浏览器设置后重试。', {
      cause: error,
    });
  }
  const unavailable = unsupported(browser);
  if (unavailable) {
    return unavailable;
  }
  const variant = browser.kind === 'firefox' ? 'firefox' : 'chromium';
  const directory = await requireBrowserExtension(variant);
  const managerUrl = extensionManager(browser.kind);
  const url = issueInstallGuide({ browser: browser.name, directory, managerUrl, variant });
  try {
    const launch = await defaultBrowserLaunch(browser, url);
    await installerHandoff(
      spawn(launch.command, launch.args, { stdio: 'ignore', detached: true, windowsHide: true }),
    );
  } catch (error) {
    throw new Error(
      `无法在默认浏览器 ${browser.name} 打开安装入口：${error instanceof Error ? error.message : String(error)}。扩展目录：${directory}`,
      { cause: error },
    );
  }
  const instructions =
    variant === 'firefox'
      ? '当前包尚未经过 Mozilla 签名，请在“此 Firefox”中点击“临时载入附加组件”，选择目录内的 manifest.json；重启浏览器后需重新载入。'
      : '请启用“开发者模式”，点击“加载已解压的扩展程序”，选择向导中提供的扩展目录。';
  return {
    status: 'opened',
    browser: browser.name,
    variant,
    directory,
    url,
    managerUrl,
    message: `已向默认浏览器 ${browser.name} 发送安装向导。请在向导中复制管理页地址并粘贴到浏览器地址栏。${instructions}\n向导：${url}\n扩展目录：${directory}`,
  };
}
