import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type AddressInfo, type Server } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import KeyvRedis from '@keyv/redis';
import { ROOT } from '../common/paths.ts';
import { smokeTerminal } from '../../terminal/smoke.ts';

const processes = new Set<ChildProcess>();
const sockets = new Set<Server>();
const password = 'smoke@:/?#%';
let temporary: string | undefined;
let foreign: KeyvRedis<string> | undefined;

function child(command: string, args: string[], cwd: string, env = process.env) {
  const processChild = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  processes.add(processChild);
  let output = '';
  processChild.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });
  processChild.stderr?.on('data', (chunk) => {
    output += chunk.toString();
  });
  const completion = new Promise<number | null>((resolve, reject) => {
    processChild.once('error', reject);
    processChild.once('close', (code) => {
      processes.delete(processChild);
      resolve(code);
    });
  });
  return { process: processChild, completion, output: () => output };
}

async function waitFor(test: () => boolean | Promise<boolean>, label: string) {
  const deadline = Date.now() + 10000;
  while (!(await test())) {
    if (Date.now() > deadline) {
      throw new Error(`等待超时：${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function reserve() {
  const server = createServer();
  sockets.add(server);
  // 与核心使用相同的通配监听地址，覆盖系统的 IPv4 / IPv6 绑定差异。
  server.listen(0);
  await once(server, 'listening');
  return { server, port: (server.address() as AddressInfo).port };
}

async function plugin(directory: string, label: string) {
  const destination = path.join(directory, 'smoke');
  await fs.mkdir(path.join(destination, 'web'), { recursive: true });
  await fs.writeFile(
    path.join(destination, 'package.json'),
    JSON.stringify({ name: label, main: 'index.ts', type: 'module', commandName: 'smoke' }),
  );
  await fs.writeFile(
    path.join(destination, 'web/index.html'),
    '<html><body>standalone-plugin</body></html>',
  );
  await fs.writeFile(
    path.join(destination, 'index.ts'),
    `
let cache;
export default {
  name: ${JSON.stringify(label)},
  async onLoad(logger, context) { cache = context.cache; await cache.set('shared', ${JSON.stringify(label)}); logger.info('SMOKE_READY'); },
  onRequest() {},
  pluginConfig: { command: { async execute(logger, options, unused, original, context) {
    if (original[1] === 'input') {
      const [error, value] = await context.next('SMOKE_DIRECT_INPUT?', Number);
      logger.info(error ? 'SMOKE_DIRECT_ERROR:' + error.name + ':' + error.code : 'SMOKE_DIRECT_VALUE:' + value);
      return;
    }
    logger.info('SMOKE_COMMAND');
  } } },
  ui: { entry: 'web/index.html', api: [{ method: 'get', path: 'status', async handler() { return { value: await cache.get('shared') }; } }] },
};
`,
  );
}

async function main() {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-executable-smoke-'));
  const deployment = path.join(temporary, 'deployment');
  const launch = path.join(temporary, 'unrelated-cwd');
  await fs.mkdir(deployment);
  await fs.mkdir(launch);
  const filename = process.platform === 'win32' ? 'scwc.exe' : 'scwc';
  const executable = path.join(deployment, filename);
  await fs.copyFile(path.join(ROOT, 'dist/core', filename), executable);
  await fs.writeFile(path.join(launch, '.env'), 'PORT=1\nREDIS_PORT=1\n');
  await plugin(path.join(deployment, 'plugins'), 'default-plugin');
  await plugin(path.join(deployment, 'environment-plugins'), 'environment-plugin');
  await plugin(path.join(deployment, 'command plugins'), 'command-plugin');

  const redisAddress = await reserve();
  await new Promise<void>((resolve) => redisAddress.server.close(() => resolve()));
  const redis = child(
    process.env.SCWC_TEST_REDIS_SERVER ?? 'redis-server',
    [
      '--bind',
      '127.0.0.1',
      '--port',
      String(redisAddress.port),
      '--save',
      '',
      '--appendonly',
      'no',
      '--requirepass',
      password,
      '--dir',
      temporary,
    ],
    temporary,
  );
  await waitFor(() => redis.output().includes('Ready to accept connections'), '独立 Redis');
  foreign = new KeyvRedis(
    { socket: { host: '127.0.0.1', port: redisAddress.port }, password },
    { namespace: 'scwc-smoke-foreign' },
  );
  await foreign.set('preserved', 'foreign-value');

  const http = await reserve();
  assert(http.port < 65515, '测试需要至少 20 个后续候选端口');
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(http.port),
    PORT_SEARCH_RANGE: '20',
    TOKEN: 'smoke-token',
    HOST: 'http://localhost',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: String(redisAddress.port),
    REDIS_USER: '',
    REDIS_PASSWORD: password,
    REDIS_TIMEOUT: '1000',
    REDIS_KEY_PREFIX: 'scwc-smoke-default',
    SCWC_PLUGIN_DIR: undefined,
  };

  async function run(expected: string, prefix: string, confirmation?: 'y' | 'n') {
    const core = child(
      executable,
      [
        '--no-terminal',
        ...(confirmation ? ['--plugin-dir', path.join(deployment, 'command plugins')] : []),
      ],
      launch,
      environment,
    );
    if (confirmation) {
      await waitFor(
        () => core.output().includes('环境中的 SCWC_PLUGIN_DIR 将会被覆盖'),
        '插件目录确认',
      );
      core.process.stdin?.write(`${confirmation}\n`);
    }
    await waitFor(() => core.output().includes('SMOKE_READY'), `插件 ${expected} 启动`);
    const port = Number(core.output().match(/http:\/\/localhost:(\d+)/)?.[1]);
    assert(port > http.port, `实际端口应跳过被占用的起始端口（期望 > ${http.port}，实际 ${port}）`);
    const origin = `http://localhost:${port}`;
    const headers = { Origin: origin, Authorization: 'Bearer smoke-token' };
    const request = async (route: string) =>
      fetch(`${origin}${route}?site=${encodeURIComponent(origin)}`, { headers });
    assert.equal((await request('/web/')).status, 200);
    assert((await (await request('/web/page/worry/404')).text()).includes('404 Not Found'));
    const web = await (await request('/web/')).text();
    const asset = web.match(/src="([^"]+\.js)"/)?.[1];
    assert(asset);
    assert.equal((await request(asset)).status, 200);
    assert.equal(
      (await request('/web/page/resources/vscode-codicons/icons/terminal.svg')).status,
      200,
    );
    const safeIdResponse = (await (await request('/web/api/safeId/smoke')).json()) as {
      data: { safeId: string };
    };
    const status = (await (
      await request(`/web/api/plugin/${safeIdResponse.data.safeId}/status`)
    ).json()) as { data: { value: string } };
    assert.equal(status.data.value, expected, '插件宿主通过密码认证后的 Redis 缓存可读取');
    const page = await (await request('/web/page/plugin/smoke')).text();
    assert(
      page.includes('standalone-plugin') && page.includes('scwcutils.iife.'),
      '私有页面注入内置库',
    );
    core.process.stdin?.write('smoke\n');
    await waitFor(() => core.output().includes('SMOKE_COMMAND'), '确认后仍可执行命令');
    core.process.stdin?.write('smoke input\ninvalid\n42\n');
    await waitFor(
      () => core.output().includes('SMOKE_DIRECT_VALUE:42'),
      '直接核心管道输入及格式重试',
    );
    core.process.stdin?.write('smoke input\n');
    await waitFor(
      () => core.output().split('SMOKE_DIRECT_INPUT?').length >= 4,
      '直接核心等待中断输入',
    );
    core.process.kill('SIGINT');
    await waitFor(
      () => core.output().includes('SMOKE_DIRECT_ERROR:InvocationInputError:cancelled'),
      '直接核心 SIGINT 返回错误元组',
    );
    assert.equal(core.process.exitCode, null, '取消输入后核心继续运行');
    assert((await foreign?.client.keys(`${prefix}::*`))?.length, 'Redis 键使用配置前缀');
    core.process.stdin?.write('exit\n');
    await waitFor(() => core.process.exitCode !== null, '核心退出');
    assert.equal(await core.completion, 0);
    assert.equal((await foreign?.client.keys(`${prefix}::*`))?.length, 0, '退出清理当前前缀');
    assert.equal(await foreign?.get('preserved'), 'foreign-value', '退出不清理其他前缀');
  }

  await run('default-plugin', 'scwc-smoke-default');
  await fs.writeFile(
    path.join(deployment, '.env'),
    `PORT=${http.port}\nPORT_SEARCH_RANGE=20\nTOKEN=smoke-token\nREDIS_HOST=127.0.0.1\nREDIS_PORT=${redisAddress.port}\nREDIS_USER=\nREDIS_PASSWORD="${password}"\nREDIS_TIMEOUT=1000\nREDIS_KEY_PREFIX=scwc-smoke-adjacent\nSCWC_PLUGIN_DIR=./environment-plugins\n`,
  );
  environment.REDIS_PASSWORD = 'deliberately-wrong';
  environment.REDIS_PORT = '1';
  await run('environment-plugin', 'scwc-smoke-adjacent', 'n');
  await run('command-plugin', 'scwc-smoke-adjacent', 'y');
  const exhausted = child(executable, ['--no-terminal', '--port-range=0'], launch, environment);
  assert.equal(await exhausted.completion, 1);
  assert(exhausted.output().includes('超过最大查询范围 0'));
  await smokeTerminal(executable, deployment, launch, environment);
  console.log(
    '独立部署验证通过：脱离源码、同目录 .env 优先、端口递增/耗尽、静态资源、插件子进程、Redis 密码/前缀隔离、目录覆盖确认、命令与退出。',
  );
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await foreign?.disconnect();
    for (const server of sockets) {
      if (server.listening) {
        server.close();
      }
    }
    for (const processChild of processes) {
      processChild.kill('SIGTERM');
    }
    await Promise.all(
      [...processes].map((processChild) => once(processChild, 'close').catch(() => undefined)),
    );
    if (temporary) {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  });
