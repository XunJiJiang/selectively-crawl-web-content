import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

// 真实 Web + HTTP + Chrome 验证；隔离数据库、系统安装器和浏览器 profile。
const root = path.resolve(import.meta.dirname, '../../..');
const temporary = await fs.mkdtemp(path.join(root, 'node_modules/.tmp/scwc-installer-smoke-'));
await fs.mkdir(path.join(temporary, 'plugins'));
Object.assign(process.env, {
  HOST: 'http://localhost',
  TOKEN: 'scwc-installer-test-token',
  REDIS_ENABLED: 'false',
  SCWC_DATA_DIR: path.join(temporary, 'data'),
  SCWC_WEB_WORKBENCH_DB: path.join(temporary, 'workbench.sqlite'),
  SCWC_PLUGIN_DIR: path.join(temporary, 'plugins'),
});
registerHooks({
  load(url, context, next) {
    if (url.endsWith('/projects/server/common/environment.ts')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export function loadEnvironment() {}',
      };
    }
    if (url.endsWith('/projects/server/utils/browser-extension.ts')) {
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export const openBrowserExtensionInstaller=()=>globalThis.__scwcInstallerTest(); export const notifyBrowserExtensionFailure=async()=>undefined; export const notifyBrowserExtensionUnsupported=async()=>undefined;',
      };
    }
    return next(url, context);
  },
});
const { issueInstallGuide } = await import('../../server/utils/extension-install-guide.ts');
const { app } = await import('../../server/router/index.ts');
const { setListeningPort } = await import('../../server/common/env.ts');
const { attachUpgradeDispatcher } = await import('../../server/router/web/workbench/websocket.ts');
const { closeWorkbench } = await import('../../server/workbench/runtime.ts');
const { closeStorage } = await import('../../server/workbench/storage.ts');
let calls = 0,
  guideUrl = '';
Object.assign(globalThis, {
  __scwcInstallerTest: async () => {
    calls++;
    await delay(500);
    guideUrl = issueInstallGuide({
      browser: 'Chrome',
      directory: path.join(root, 'dist/browser-extension/chromium'),
      managerUrl: 'chrome://extensions/',
      variant: 'chromium',
    });
    return {
      status: 'opened',
      browser: 'Chrome',
      url: guideUrl,
      managerUrl: 'chrome://extensions/',
      message: '已打开安装向导，请复制管理页地址完成安装。',
    };
  },
});
const server = createServer(app);
attachUpgradeDispatcher(server);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port;
setListeningPort(port);
const origin = `http://localhost:${port}`;
const profile = path.join(temporary, 'chrome-profile');
const executable =
  process.env.SCWC_CHROME_BINARY ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const child = spawn(
  executable,
  [
    '--headless=new',
    '--no-first-run',
    '--no-sandbox',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `${origin}/web/`,
  ],
  { windowsHide: true, stdio: 'ignore' },
);
let socket: WebSocket | undefined,
  sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
>();
async function cdp(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<Record<string, unknown>> {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error('CDP 未连接');
  }
  const id = ++sequence;
  const timer = setTimeout(() => {
    pending.get(id)?.reject(new Error(`CDP 超时：${method}`));
    pending.delete(id);
  }, 10000);
  const result = new Promise<Record<string, unknown>>((resolve, reject) =>
    pending.set(id, { resolve, reject }),
  );
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  try {
    return await result;
  } finally {
    clearTimeout(timer);
  }
}
async function until(check: () => Promise<boolean>, label: string) {
  for (let i = 0; i < 100; i++) {
    if (await check()) {
      return;
    }
    await delay(100);
  }
  throw new Error(`等待失败：${label}`);
}
try {
  let endpoint = '';
  await until(async () => {
    try {
      endpoint = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8');
      return !!endpoint;
    } catch {
      return false;
    }
  }, 'Chrome 调试入口');
  const [debugPort, socketPath] = endpoint.trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${debugPort}${socketPath}`);
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)),
      request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(JSON.stringify(message.error)));
      } else {
        request.resolve(message.result ?? {});
      }
    }
  };
  await new Promise<void>((resolve, reject) => {
    if (!socket) {
      return;
    }
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('CDP 连接失败'));
  });
  const targets = (await cdp('Target.getTargets')) as {
    targetInfos: { targetId: string; url: string }[];
  };
  const page = targets.targetInfos.find((target) => target.url === `${origin}/web/`);
  assert.ok(page);
  const session = String(
    (await cdp('Target.attachToTarget', { targetId: page.targetId, flatten: true })).sessionId,
  );
  async function evaluate(expression: string, targetSession = session) {
    const result = await cdp(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      targetSession,
    );
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return (result.result as { value: unknown }).value;
  }
  await until(
    async () => !!(await evaluate("document.querySelector('app-root')?.store?.workspace")),
    '工作台加载',
  );
  // 模拟休眠的工作区，安装操作仍必须直接发出真实 HTTP 请求。
  await evaluate(
    "document.querySelector('app-root').store.api.requests.pause(); document.querySelector('app-root').store.api.beforeRequest=()=>new Promise(()=>{}); document.querySelector('app-root').command('quickOpen')",
  );
  await cdp('Input.insertText', { text: '>安装浏览器扩展' }, session);
  await cdp(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    session,
  );
  await cdp(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    session,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('app-root').store.toasts.some(t=>t.text==='正在打开浏览器扩展安装向导…')",
    ),
    true,
  );
  await until(async () => calls === 1 && !!guideUrl, 'Web 安装请求');
  await until(
    async () =>
      !!(await evaluate(
        "document.querySelector('app-root').store.toasts.some(t=>t.text.includes('已打开安装向导'))",
      )),
    '安装反馈',
  );
  assert.equal(calls, 1);
  // 使用普通 URL 验证新的浏览器进程，不加 chrome:// 放行或扩展调试开关。
  // Headless 不复用同一个 profile 的进程，因此单独使用 guide-profile。
  const handoff = spawn(
    executable,
    [
      '--headless=new',
      '--no-first-run',
      '--no-sandbox',
      `--user-data-dir=${path.join(temporary, 'guide-profile')}`,
      '--dump-dom',
      guideUrl,
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let launcherOutput = '';
  handoff.stderr.on('data', (chunk) => {
    launcherOutput += String(chunk);
  });
  handoff.stdout.on('data', (chunk) => {
    launcherOutput += String(chunk);
  });
  await new Promise<void>((resolve, reject) => {
    handoff.once('error', reject);
    handoff.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`浏览器转交失败 ${code}: ${launcherOutput.slice(-1600)}`)),
    );
  });
  assert.ok(
    launcherOutput.includes('<h1>浏览器扩展安装向导</h1>'),
    'Chrome 必须显示向导正文而非空白页',
  );
  await cdp('Target.createTarget', { url: guideUrl });
  let guideTarget: { targetId: string; url: string } | undefined;
  await until(async () => {
    const latest = (await cdp('Target.getTargets')) as {
      targetInfos: { targetId: string; url: string }[];
    };
    guideTarget = latest.targetInfos.find((target) => target.url === guideUrl);
    return !!guideTarget;
  }, '真实浏览器安装向导');
  assert.ok(guideTarget);
  const guideSession = String(
    (await cdp('Target.attachToTarget', { targetId: guideTarget.targetId, flatten: true }))
      .sessionId,
  );
  await until(
    async () =>
      (await evaluate("document.querySelector('h1')?.textContent", guideSession)) ===
      '浏览器扩展安装向导',
    '向导内容',
  );
  assert.equal(
    await evaluate("document.getElementById('manager').value", guideSession),
    'chrome://extensions/',
  );
  await evaluate("document.querySelector('[data-copy=manager]').click()", guideSession);
  await until(
    async () =>
      !!(await evaluate("document.getElementById('copy-status').textContent", guideSession)),
    '复制按钮反馈',
  );
  await fs.mkdir(path.join(root, 'dist/browser-extension/previews'), { recursive: true });
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png' }, guideSession);
  await fs.writeFile(
    path.join(root, 'dist/browser-extension/previews/installer-guide.png'),
    Buffer.from(String(screenshot.data), 'base64'),
  );
  console.log(
    'PASS: real Web Enter command, immediate progress, HTTP request during pause, native Chrome URL handoff, guide content and copy buttons',
  );
} finally {
  try {
    await cdp('Browser.close');
  } catch {
    child.kill();
  }
  socket?.close();
  child.kill();
  await closeWorkbench();
  closeStorage();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
