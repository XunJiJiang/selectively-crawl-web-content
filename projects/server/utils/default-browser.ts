import defaultBrowser from 'default-browser';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execute = promisify(execFile);
export type ExtensionBrowser =
  | 'chrome'
  | 'edge'
  | 'brave'
  | 'chromium'
  | 'opera'
  | 'vivaldi'
  | 'firefox'
  | 'safari'
  | 'unknown';
export interface DefaultBrowser {
  name: string;
  id: string;
  kind: ExtensionBrowser;
}
export function browserKind(id: string): ExtensionBrowser {
  const value = id.toLowerCase();
  if (/^com\.apple\.safari/.test(value)) {
    return 'safari';
  }
  if (/firefox|librewolf/.test(value)) {
    return 'firefox';
  }
  if (/microsoft.*edge|msedge/.test(value)) {
    return 'edge';
  }
  if (/brave/.test(value)) {
    return 'brave';
  }
  if (/chromium/.test(value)) {
    return 'chromium';
  }
  if (/google.*chrome|^chrome(?:[-.]|html)/.test(value)) {
    return 'chrome';
  }
  if (/opera/.test(value)) {
    return 'opera';
  }
  if (/vivaldi/.test(value)) {
    return 'vivaldi';
  }
  return 'unknown';
}
export async function detectDefaultBrowser(): Promise<DefaultBrowser> {
  if (process.platform === 'darwin') {
    // 直接读取 LaunchServices，避免为获取显示名触发 Finder/System Events 自动化授权。
    const { stdout: plist } = await execute(
      '/usr/bin/defaults',
      ['export', 'com.apple.LaunchServices/com.apple.launchservices.secure', '-'],
      { timeout: 5000 },
    );
    // LSHandlers 含嵌套字典；使用系统 plist 解析器，不能按大括号正则截取记录。
    const conversion = execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
      timeout: 5000,
    });
    conversion.child.stdin?.end(plist);
    const { stdout } = await conversion;
    const id = macDefaultBrowserId(stdout);
    const kind = browserKind(id);
    const names = {
      chrome: 'Chrome',
      edge: 'Edge',
      brave: 'Brave',
      chromium: 'Chromium',
      opera: 'Opera',
      vivaldi: 'Vivaldi',
      firefox: 'Firefox',
      safari: 'Safari',
      unknown: id,
    };
    return { id, name: names[kind], kind };
  }
  const browser = await defaultBrowser();
  return { ...browser, kind: browserKind(browser.id) };
}
export function macDefaultBrowserId(text: string) {
  const handlers: unknown = JSON.parse(text)?.LSHandlers;
  if (!Array.isArray(handlers)) {
    throw new Error('默认 HTTP 浏览器的 LaunchServices 登记无效');
  }
  const record = handlers.find(
    (entry) => entry && typeof entry === 'object' && entry.LSHandlerURLScheme === 'http',
  );
  const id: unknown = record?.LSHandlerRoleAll;
  if (record && (typeof id !== 'string' || !/^[\w-]+(?:\.[\w-]+)+$/.test(id))) {
    throw new Error('默认 HTTP 浏览器的 LaunchServices 登记无效');
  }
  return typeof id === 'string' ? id : 'com.apple.Safari';
}
export function extensionManager(browser: ExtensionBrowser) {
  if (browser === 'firefox') {
    return 'about:debugging#/runtime/this-firefox';
  }
  if (browser === 'safari' || browser === 'unknown') {
    throw new Error('此浏览器没有可用的扩展安装入口');
  }
  return `${browser === 'chromium' ? 'chrome' : browser}://extensions/`;
}
/** 只取系统登记的可执行文件，不执行 registry command 中的模板或 shell 文本。 */
export function windowsExecutable(command: string) {
  const value = command.trim();
  const executable = value.startsWith('"')
    ? value.slice(1, value.indexOf('"', 1))
    : value.match(/^(.+?\.exe)(?:\s|$)/i)?.[1];
  if (
    !executable ||
    !path.win32.isAbsolute(executable) ||
    !/\.exe$/i.test(executable) ||
    /[\0\r\n"]/.test(executable)
  ) {
    throw new Error('默认浏览器的可执行文件登记无效');
  }
  return executable;
}
export function desktopCommand(text: string) {
  const section = text.split(/^\[Desktop Entry\]\s*$/m)[1]?.split(/^\[/m)[0];
  const command = section?.match(/^Exec=(.+)$/m)?.[1];
  if (!command || command.length > 16384) {
    throw new Error('默认浏览器缺少有效的 Desktop Entry Exec');
  }
  const tokens: string[] = [];
  let token = '',
    quoted = false,
    escaped = false;
  for (const char of command.trim()) {
    if (escaped) {
      token += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (/\s/.test(char) && !quoted) {
      if (token) {
        tokens.push(token);
        token = '';
      }
    } else {
      token += char;
    }
  }
  if (quoted || escaped) {
    throw new Error('默认浏览器的 Exec 引号无效');
  }
  if (token) {
    tokens.push(token);
  }
  const parts = tokens
    .filter((part) => !/%[uUfFiIcCkK]/.test(part))
    .map((part) => part.replaceAll('%%', '%'));
  if (!parts[0]) {
    throw new Error('默认浏览器缺少可执行文件');
  }
  return { command: parts[0], args: parts.slice(1) };
}
export async function defaultBrowserLaunch(
  browser: DefaultBrowser,
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<{ command: string; args: string[] }> {
  if (platform === 'darwin') {
    return { command: '/usr/bin/open', args: ['-b', browser.id, url] };
  }
  if (platform === 'win32') {
    const { stdout: association } = await execute(
      'reg.exe',
      [
        'QUERY',
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice',
        '/v',
        'ProgId',
      ],
      { windowsHide: true, timeout: 5000 },
    );
    const progId = association.match(/ProgId\s+REG_SZ\s+(\S+)/i)?.[1];
    if (!progId || !/^[\w.-]+$/.test(progId)) {
      throw new Error('无法读取默认 HTTP 浏览器');
    }
    if (browserKind(progId) !== browser.kind) {
      throw new Error('默认浏览器已变化，请重新唤起安装');
    }
    const { stdout } = await execute(
      'reg.exe',
      ['QUERY', `HKEY_CLASSES_ROOT\\${progId}\\shell\\open\\command`, '/ve'],
      { windowsHide: true, timeout: 5000 },
    );
    const command = stdout.match(/REG_(?:EXPAND_)?SZ\s+(.+)/i)?.[1];
    if (!command) {
      throw new Error('默认浏览器缺少启动命令');
    }
    return { command: windowsExecutable(command), args: [url] };
  }
  if (platform === 'linux') {
    if (path.basename(browser.id) !== browser.id || !browser.id.endsWith('.desktop')) {
      throw new Error('默认浏览器的桌面入口无效');
    }
    const roots = [
      process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'),
      ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':'),
    ];
    for (const root of roots) {
      try {
        const text = await fs.readFile(path.join(root, 'applications', browser.id), 'utf8');
        const launch = desktopCommand(text);
        return { ...launch, args: [...launch.args, url] };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
    throw new Error('找不到默认浏览器的桌面入口');
  }
  throw new Error(`当前系统不支持浏览器安装唤起：${platform}`);
}
