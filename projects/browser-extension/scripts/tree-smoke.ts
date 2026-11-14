import { uiRequired } from '../../shared/declarative-ui.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

// Native Node + real plugin IPC + authenticated HTTP + all three shipped browser hosts.
const root = path.resolve(import.meta.dirname, '../../..');
const temporary = await fs.mkdtemp(path.join(root, 'node_modules/.tmp/tree-browser-'));
const directory = path.join(root, 'projects/server/plugins/template');
const token = 'isolated-tree-browser-test';
Object.assign(process.env, {
  HOST: 'http://127.0.0.1',
  TOKEN: token,
  REDIS_ENABLED: 'false',
  SCWC_DATA_DIR: path.join(temporary, 'data'),
  SCWC_WEB_WORKBENCH_DB: path.join(temporary, 'workbench.sqlite'),
  // The catalog scans a directory of plugin folders; keep the template folder
  // itself as the process fixture while exposing its parent to the catalog.
  SCWC_PLUGIN_DIR: path.dirname(directory),
  SCWC_TEMPLATE_TREE_DEMO_FILE: path.join(temporary, 'tree-data.json'),
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
    return next(url, context);
  },
});
const { PluginProcessClient } = await import('../../server/plugin/process/client.ts');
const logger = {
  info() {
    /* Intentionally empty fixture callback. */
  },
  warn() {
    /* Intentionally empty fixture callback. */
  },
  error() {
    /* Intentionally empty fixture callback. */
  },
  pathInfo() {
    /* Intentionally empty fixture callback. */
  },
};
const client = new PluginProcessClient({
  pluginId: 'template',
  entry: path.join(directory, 'index.ts'),
  pluginDir: directory,
  name: 'template-test',
  cwd: directory,
  logger,
  env: { ...process.env },
  execArgv: [
    '--import',
    new URL('../../server/plugins/template/tests/isolate-environment.mjs', import.meta.url).href,
  ],
  runtime: {
    mode: 'process',
    apiVersion: 2,
    startupTimeoutMs: 15000,
    requestTimeoutMs: 15000,
    shutdownTimeoutMs: 2000,
  },
  cache: () => ({
    get: async () => undefined,
    set: async <T>(_key: string, value: T) => value,
    del: async () => true,
    mdel: async () => true,
    setRedirect: async (_key: string, target: string) => target,
  }),
});
const handler = await client.start();
const { plugins } = await import('../../server/plugin/load.ts');
plugins.push({
  name: 'template-test',
  pluginId: 'template',
  safeId: 'template-test',
  pluginDir: directory,
  entryFile: path.join(directory, 'index.ts'),
  entry: handler.ui?.entry,
  linkWith: ['*'],
  logger,
  runtime: client.info,
  handler,
} as never);
const { app } = await import('../../server/router/index.ts');
const { attachUpgradeDispatcher } = await import('../../server/router/web/workbench/websocket.ts');
const { setListeningPort } = await import('../../server/common/env.ts');
const server = createServer(app);
attachUpgradeDispatcher(server);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as { port: number }).port,
  origin = `http://127.0.0.1:${port}`;
setListeningPort(port);
const profile = path.join(temporary, 'chrome');
const testExtension = path.join(temporary, 'extension');
await fs.cp(path.join(root, 'dist/browser-extension/chromium'), testExtension, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(testExtension, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
await fs.writeFile(path.join(testExtension, 'manifest.json'), JSON.stringify(manifest));
const sourceServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    '<!doctype html><meta charset="utf-8"><title>JSON tree host test</title><article>Tree test source page</article>',
  );
});
await new Promise<void>((resolve) => sourceServer.listen(0, '127.0.0.1', resolve));
const sourceOrigin = `http://127.0.0.1:${(sourceServer.address() as { port: number }).port}`;
const browser = spawn(
  process.env.SCWC_CHROME_BINARY ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--remote-debugging-port=0',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);
let socket: WebSocket | undefined,
  sequence = 0;
let closing = false;
const pending = new Map<
  number,
  { resolve(value: Record<string, unknown>): void; reject(error: Error): void }
>();
async function cdp(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<Record<string, unknown>> {
  assert.ok(socket && socket.readyState === WebSocket.OPEN);
  const id = ++sequence,
    timer = setTimeout(() => {
      pending.get(id)?.reject(new Error(`CDP timeout: ${method}`));
      pending.delete(id);
    }, 15000);
  const promise = new Promise<Record<string, unknown>>((resolve, reject) =>
    pending.set(id, { resolve, reject }),
  );
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
  }
}
async function evaluate(session: string, expression: string): Promise<unknown> {
  const result = await cdp(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    session,
  );
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return (result.result as { value?: unknown }).value;
}
async function until(check: () => Promise<unknown>, label: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      /* Page may still be navigating. */
    }
    await delay(100);
  }
  throw new Error(`等待失败：${label}`);
}
async function page(url: string) {
  const target = await cdp('Target.createTarget', { url });
  const attached = await cdp('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await cdp('Runtime.enable', {}, String(attached.sessionId));
  await cdp(
    'Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
    String(attached.sessionId),
  );
  return { targetId: target.targetId, session: String(attached.sessionId) };
}
const previews = path.join(root, 'dist/browser-extension/previews/tree');
async function checkTreeHost(
  session: string,
  viewRoot: string,
  label: string,
  theme: (value: string) => string,
) {
  try {
    await until(
      () => evaluate(session, `${viewRoot}?.querySelector('.ui-tree-host')`),
      `${label} tree mount`,
    );
  } catch (error) {
    const diagnostics = await evaluate(
      session,
      `JSON.stringify({root:!!(${viewRoot}),html:(${viewRoot})?.innerHTML?.slice(0,2000),appError:document.querySelector('app-root')?.shadowRoot?.querySelector('[data-error]')?.textContent})`,
    ).catch(() => 'unavailable');
    console.error(`[tree-smoke] ${label} mount diagnostics: ${String(diagnostics)}`);
    throw error;
  }
  await evaluate(session, `${viewRoot}.querySelector('[data-ui-tab-trigger="tree"]')?.click()`);
  const staticTree = `${viewRoot}.querySelector('[name=staticFiles]')`;
  await until(
    () => evaluate(session, `${staticTree}?.querySelector('[data-tree-id="static-main"]')`),
    `${label} static rows`,
  );
  await evaluate(session, `${staticTree}.querySelector('[data-tree-id="static-main"]').click()`);
  await evaluate(
    session,
    `${staticTree}.querySelector('[data-tree-id="static-config"]').dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}))`,
  );
  assert.equal(
    await evaluate(session, `${staticTree}.querySelectorAll('[aria-selected=true]').length`),
    2,
    `${label} Ctrl selection`,
  );
  assert.equal(
    await evaluate(session, `${staticTree}.querySelectorAll('option').length`),
    0,
    'virtual tree must not create option proxies',
  );
  await evaluate(
    session,
    `(()=>{const tree=${staticTree},source=tree.querySelector('[data-tree-id="static-main"]'),target=tree.querySelector('[data-tree-id="static-docs"]');const transfer=new DataTransfer();source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));const bounds=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:bounds.top+bounds.height/2}));})()`,
  );
  const dragShot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  await fs.writeFile(
    path.join(previews, `${label}-drop.png`),
    Buffer.from(String(dragShot.data), 'base64'),
  );
  await evaluate(
    session,
    `(()=>{const tree=${staticTree},target=tree.querySelector('[data-tree-id="static-docs"]');target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));})()`,
  );
  await until(
    () =>
      evaluate(session, `${staticTree}.querySelector('.tree-live').textContent.includes('已保存')`),
    `${label} static move`,
  );
  await evaluate(
    session,
    `${staticTree}.querySelector('[data-tree-id="static-docs"] [data-tree-twistie]').click()`,
  );
  await until(
    () => evaluate(session, `${staticTree}.querySelector('[data-tree-id="static-main"]')`),
    `${label} moved selection`,
  );
  const dynamic = `${viewRoot}.querySelector('[name=dynamicFiles]')`;
  await evaluate(session, `${dynamic}.scrollIntoView({block:'start'})`);
  await until(
    () => evaluate(session, `${dynamic}.querySelector('[data-tree-id="source"]')`),
    `${label} dynamic root`,
  );
  await evaluate(
    session,
    `${dynamic}.querySelector('[data-tree-id="source"] [data-tree-twistie]').click()`,
  );
  await until(
    () =>
      evaluate(session, `${dynamic}.querySelector('[data-tree-id="file-1"] [data-tree-action]')`),
    `${label} real controller rows/actions`,
  );
  const dimensions = (await evaluate(
    session,
    `(()=>{const tree=${dynamic},scroll=tree.querySelector('wb-scroll-container');return {rows:tree.querySelectorAll('.tree-row').length,logical:scroll.scrollState.scrollHeight,height:scroll.scrollState.clientHeight};})()`,
  )) as { rows: number; logical: number; height: number };
  assert.ok(
    dimensions.rows < 45 && dimensions.logical > dimensions.height,
    `${label} bounded virtual DOM: ${JSON.stringify(dimensions)}`,
  );
  await evaluate(session, `${dynamic}.querySelector('[data-tree-id="file-1"]').click()`);
  const before = await evaluate(
    session,
    `${dynamic}.querySelectorAll('[aria-selected=true]').length`,
  );
  await evaluate(session, `${dynamic}.querySelector('[data-tree-action]').click()`);
  assert.equal(
    await evaluate(session, `${dynamic}.querySelectorAll('[aria-selected=true]').length`),
    before,
    `${label} actions do not select their row`,
  );
  for (const mode of ['dark-2026', 'light-2026']) {
    await evaluate(session, theme(mode));
    await delay(100);
    const shot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
    await fs.writeFile(
      path.join(previews, `${label}-${mode}.png`),
      Buffer.from(String(shot.data), 'base64'),
    );
  }
  await evaluate(
    session,
    `(()=>{const input=${dynamic}.querySelector('.tree-search');input.value='module-0400';input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(
    () => evaluate(session, `${dynamic}.querySelector('[data-tree-id="file-400"] mark')`),
    `${label} remote search and highlight`,
  );
  assert.equal(
    await evaluate(session, `${dynamic}.querySelector('[data-tree-id="file-400"]').draggable`),
    false,
  );
  const searchShot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  await fs.writeFile(
    path.join(previews, `${label}-search.png`),
    Buffer.from(String(searchShot.data), 'base64'),
  );
  await evaluate(
    session,
    `(()=>{const input=${dynamic}.querySelector('.tree-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await until(
    () =>
      evaluate(
        session,
        `(()=>${dynamic}.querySelector('[data-tree-id="source"][aria-expanded=true]') && !${dynamic}.querySelector('[data-tree-id="file-400"]'))()`,
      ),
    `${label} restored expansion`,
  );
  await evaluate(
    session,
    `(()=>{const scroll=${dynamic}.querySelector('wb-scroll-container');scroll.scrollTo({top:400,behavior:'instant'});})()`,
  );
  await delay(80);
  const scrollState = (await evaluate(
    session,
    `(()=>{const tree=${dynamic},scroll=tree.querySelector('wb-scroll-container');const state=scroll.scrollState;return {top:state.scrollTop,max:state.maxScrollTop,logical:state.scrollHeight,height:state.clientHeight,rows:tree.querySelectorAll('.tree-row').length,expanded:tree.querySelector('[data-tree-id="source"]')?.getAttribute('aria-expanded')}})()`,
  )) as { top: number; max: number; logical: number; height: number };
  assert.ok(scrollState.top > 0, `${label} native viewport scroll: ${JSON.stringify(scrollState)}`);
  await evaluate(
    session,
    `${dynamic}.querySelector('wb-scroll-container').scrollTo({top:0,behavior:'instant'})`,
  );
  await evaluate(
    session,
    `${dynamic}.querySelector('[data-tree-id="source"] [data-tree-twistie]').click()`,
  );
  await evaluate(
    session,
    `${dynamic}.querySelector('[data-tree-id="retry"] [data-tree-twistie]').click()`,
  );
  await until(
    () => evaluate(session, `${dynamic}.querySelector('[data-tree-aux="retry"]')`),
    `${label} error row`,
  );
  const errorShot = await cdp('Page.captureScreenshot', { format: 'png' }, session);
  await fs.writeFile(
    path.join(previews, `${label}-load-error.png`),
    Buffer.from(String(errorShot.data), 'base64'),
  );
  await evaluate(session, `${dynamic}.querySelector('[data-tree-aux="retry"] button').click()`);
  await until(
    () => evaluate(session, `${dynamic}.querySelector('[data-tree-id="recovered"]')`),
    `${label} retry`,
  );
  console.log(
    `PASS ${label}: real JSON host, IPC controllers, multi-selection, actions, virtual scroll, search restore, themes, loading error/retry`,
  );
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
  }, 'Chrome CDP');
  const [debugPort, route] = endpoint.trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${debugPort}${route}`);
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.bindingCalled' && message.params.name === 'treeGM') {
      const request = JSON.parse(message.params.payload);
      void fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.data,
      })
        .then(async (response) => {
          const result = {
            status: response.status,
            statusText: response.statusText,
            responseText: await response.text(),
            responseHeaders: 'content-type: application/json',
          };
          await cdp(
            'Runtime.evaluate',
            {
              expression: `globalThis.treeGMReplies.get(${request.id})?.onload(${JSON.stringify(result)});treeGMReplies.delete(${request.id})`,
            },
            message.sessionId,
          );
        })
        .catch((error) => {
          if (!closing) {
            console.error('GM bridge failed', error);
          }
        });
    }
    const request = pending.get(message.id);
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
    uiRequired(socket).onopen = () => resolve();
    uiRequired(socket).onerror = () => reject(new Error('CDP failed'));
  });
  await fs.mkdir(previews, { recursive: true });
  const workbench = await page(`${origin}/web/`);
  await until(
    () => evaluate(workbench.session, "document.querySelector('app-root')?.store?.workspace"),
    'Workbench boot',
  );
  await evaluate(
    workbench.session,
    `(async()=>{const app=document.querySelector('app-root');await app.store.update(s=>{s.layout.mainSidebar.selectedView={kind:'plugin',pluginId:'template',viewId:'template-overview'};s.layout.mainSidebar.visible=true;s.layout.mainSidebar.size=500;});})()`,
  );
  const wbRoot = `document.querySelector('app-root').shadowRoot.querySelector('wb-declarative-view[surface=mainSidebar]')?.shadowRoot`;
  await checkTreeHost(
    workbench.session,
    wbRoot,
    'workbench',
    (mode) => `document.documentElement.setAttribute('data-theme','${mode}')`,
  );
  const source = await page(`${sourceOrigin}/tree-fixture-page`);
  const extension = await cdp('Extensions.loadUnpacked', { path: testExtension });
  const tabs = await cdp('Target.getTargets', {
    filter: [{ type: 'tab', exclude: false }, { exclude: true }],
  });
  const tabTarget = (tabs.targetInfos as { targetId: string; url: string }[]).find(
    (tab) => tab.url === `${sourceOrigin}/tree-fixture-page`,
  );
  assert.ok(tabTarget);
  await cdp('Extensions.triggerAction', { id: extension.id, targetId: tabTarget.targetId });
  let popupTarget: { targetId: string; url: string } | undefined;
  await until(async () => {
    const targets = await cdp('Target.getTargets');
    popupTarget = (targets.targetInfos as { targetId: string; url: string }[]).find(
      (target) => target.url === `chrome-extension://${extension.id}/index.html`,
    );
    return popupTarget;
  }, 'Extension popup');
  const popup = String(
    (
      await cdp('Target.attachToTarget', {
        targetId: uiRequired(popupTarget).targetId,
        flatten: true,
      })
    ).sessionId,
  );
  await until(
    () => evaluate(popup, "document.querySelector('scwc-extension')?.snapshot"),
    'Extension init',
  );
  const { defaultSiteData } = await import('../../shared/userscript-config.ts');
  const config = defaultSiteData().config;
  config.api.host = 'http://127.0.0.1';
  config.api.port = String(port);
  config.api.token = token;
  await evaluate(
    popup,
    `(async()=>{const app=document.querySelector('scwc-extension');app.config=${JSON.stringify(config)};await app.saveConnection();app.panel='plugins';app.activePlugin='template';await app.updateComplete;})()`,
  );
  const extensionRoot =
    "document.querySelector('scwc-extension').shadowRoot.querySelector('scwc-script-ui')?.shadowRoot";
  // The failure demo is per provider. Refresh resets it only for a separate fixture instance;
  // subsequent hosts validate loading, selection, rendering and search against the same provider.
  await checkTreeHost(
    popup,
    extensionRoot,
    'extension',
    (mode) => `document.querySelector('scwc-extension').setAttribute('data-theme','${mode}')`,
  );
  await cdp('Runtime.addBinding', { name: 'treeGM' }, source.session);
  const snapshot = {
    version: 1,
    website: sourceOrigin,
    updatedAt: new Date().toISOString(),
    data: defaultSiteData(config),
  };
  snapshot.data.plugin = { expanded: true, activeTab: 'template' };
  snapshot.data.window.minimized = false;
  snapshot.data.window.pos = { x: 8, y: 8 };
  await evaluate(
    source.session,
    `localStorage.setItem('__scwc_website_config__',${JSON.stringify(JSON.stringify(snapshot))});globalThis.unsafeWindow=window;globalThis.treeGMReplies=new Map();globalThis.treeGMId=0;globalThis.GM_xmlhttpRequest=options=>{const id=++treeGMId;treeGMReplies.set(id,options);treeGM(JSON.stringify({id,url:options.url,method:options.method,headers:options.headers,data:options.data}));return {abort(){treeGMReplies.delete(id)}}};`,
  );
  const bundle = await fs.readFile(path.join(root, 'dist/user-script/scwc.user.js'), 'utf8');
  await evaluate(source.session, bundle);
  const scriptRoot =
    "document.querySelector('scwc-layout-root')?.shadowRoot.querySelector('scwc-layout-content')?.shadowRoot.querySelector('scwc-layout-content-plugin')?.shadowRoot.querySelector('scwc-script-ui')?.shadowRoot";
  await checkTreeHost(
    source.session,
    scriptRoot,
    'userscript',
    (mode) => `document.querySelector('scwc-layout-root').setAttribute('data-theme','${mode}')`,
  );
  console.log(`Tree screenshots: ${previews}`);
} finally {
  closing = true;
  try {
    await cdp('Browser.close');
  } catch {
    browser.kill();
  }
  socket?.close();
  browser.kill();
  await client.stop(false);
  const { closeWorkbench } = await import('../../server/workbench/runtime.ts');
  await closeWorkbench();
  const { closeStorage } = await import('../../server/workbench/storage.ts');
  closeStorage();
  const { closeUserScriptConfig } = await import('../../server/user-script/config.ts');
  await closeUserScriptConfig();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  sourceServer.closeAllConnections();
  await new Promise<void>((resolve) => sourceServer.close(() => resolve()));
}
