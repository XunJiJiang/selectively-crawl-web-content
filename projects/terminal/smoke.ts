import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { TerminalModel } from './model.ts';
import { CoreConnection } from './core.ts';
import { TerminalController } from './controller.ts';
import { StateStore } from './storage.ts';

async function waitFor(test: () => boolean, label: string, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!test()) {
    if (Date.now() > deadline) {
      throw new Error('终端验证等待超时：' + label);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
const fixture = `
let savedLogger;
export default {
  onLoad(logger) { savedLogger = logger; logger.info('TERMINAL_CORE_READY'); },
  onRequest() {},
  pluginConfig: { command: {
    subCommands: Array.from({ length: 80 }, (_, i) => ({ name: 'sub' + i, description: 'HELP_SUB_' + i, execute() {} })),
    async execute(logger, options, unused, original, context) {
    const type = original[1] ?? 'quick';
    logger.info('OWNERSHIP:' + logger.windowId + ':' + logger.executionId);
    if (type === 'color') {
      logger.info('CORE_COLOR_LEVEL:' + process.env.FORCE_COLOR);
      logger.warn('CORE_COLOR_WARNING'); logger.error('CORE_COLOR_ERROR');
      logger.info('CUSTOM_COLOR:\\x1b[35mmagenta\\x1b[39m');
      console.log({ color: true }); logger.info('CORE_COLOR_DONE'); return;
    }
    if (type === 'burst') { for (let i = 0; i < 250; i++) savedLogger.info('BURST:' + i); logger.info('LONG:' + 'x'.repeat(9000) + ':END'); return; }
    if (type === 'input') {
      const [nameError, name] = await context.next('INPUT_NAME?' + (original[2] ?? ''), String);
      if (nameError) { logger.info('INPUT_ERROR:' + nameError.name + ':' + nameError.code); return; }
      const [countError, count] = await context.next('INPUT_COUNT?', Number);
      if (countError) return;
      const [confirmedError, confirmed] = await context.next('INPUT_CONFIRMED?', Boolean);
      if (confirmedError) return;
      logger.info('INPUT_RESULT:' + name + ':' + count + ':' + confirmed); return;
    }
    if (type === 'hold') { context.tasks.setBusy(true); return; }
    if (type === 'background') {
      context.tasks.setBusy(true);
      const finish = () => { logger.info('BACKGROUND_DONE'); context.tasks.setBusy(false); };
      const timer = setTimeout(finish, Number(original[2] ?? 3000));
      context.signal.addEventListener('abort', () => { clearTimeout(timer); finish(); }, { once: true });
      logger.info('FUNCTION_RETURNING'); return;
    }
    if (type === 'late') { setTimeout(() => logger.info('LATE_OUTPUT'), 600); }
    logger.info('QUICK_DONE');
  } } },
};
`;
export async function smokeTerminal(
  executable: string,
  deployment: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  const plugin = path.join(deployment, 'environment-plugins/smoke');
  await fs.writeFile(path.join(plugin, 'index.ts'), fixture);
  const cmdPlugin = path.join(deployment, 'terminal/plugins/test');
  await fs.mkdir(cmdPlugin, { recursive: true });
  await fs.writeFile(
    path.join(cmdPlugin, 'package.json'),
    JSON.stringify({ main: 'index.ts', type: 'module' }),
  );
  await fs.writeFile(
    path.join(cmdPlugin, 'index.ts'),
    `export default { onLoad({ registerCommand }) {
      registerCommand({ name: 'relay', description: 'nested core command', async execute(context) { context.logger.info('TERMINAL_PLUGIN:' + context.windowId); await context.invokeCore('smoke background 150'); context.write('RELAY_DONE'); } });
      registerCommand({ name: 'ask', description: 'local input', async execute(context) { const [error, value] = await context.next('LOCAL_INPUT?', Number); context.write(error ? 'LOCAL_ERROR:' + error.code : 'LOCAL_RESULT:' + value); } });
      registerCommand({ name: 'relay-ask', description: 'nested input', async execute(context) { await context.invokeCore('smoke input'); context.write('RELAY_INPUT_DONE'); } });
      registerCommand({ name: 'colors', description: 'terminal colors', execute(context) { context.logger.warn('TERMINAL_COLOR_WARNING'); context.logger.error('TERMINAL_COLOR_ERROR'); context.logger.info({ color: true }); context.write('TERMINAL_COLOR_LEVEL:' + process.env.FORCE_COLOR); context.write('TERMINAL_COLOR_DONE'); } });
    } };`,
  );
  const model = new TerminalModel();
  const original = model.windows[1];
  const second = model.newWindow();
  const core = new CoreConnection({ entry: executable, execPath: executable, args: [], cwd, env });
  const controller = new TerminalController(model, core);
  const store = new StateStore(path.join(deployment, 'wire-state.json'));
  await store.lock();
  try {
    await controller.start();
    await waitFor(() => controller.commands.some((info) => info.name === 'smoke'), '业务插件就绪');
    await controller.plugins.load(
      path.join(deployment, 'terminal/plugins'),
      model.output.id,
      controller.commands,
    );
    await controller.global('run 1 help smoke');
    await waitFor(
      () => !original.task && original.lines.some((line) => line.includes('HELP_SUB_79')),
      '完整帮助输出',
    );
    assert.equal(original.lines.filter((line) => line.includes('HELP_SUB_')).length, 80);
    await controller.global('run 1 smoke burst');
    await waitFor(
      () => !original.task && original.lines.some((line) => line.includes(':END')),
      '完整高频及长日志',
    );
    assert.equal(original.lines.filter((line) => line.includes('BURST:')).length, 250);
    assert(original.lines.some((line) => line.includes('LONG:' + 'x'.repeat(9000) + ':END')));
    assert(!original.lines.some((line) => line.includes('[succeeded]')));
    await controller.global('run 1 smoke input');
    await controller.global('run 2 smoke input');
    await waitFor(() => Boolean(original.input && second.input), '两个窗口同时等待输入');
    model.switch(original.id);
    await controller.line('first name');
    await waitFor(() => original.input?.type === 'number', '数值输入');
    await controller.line('bad number');
    await waitFor(
      () => original.input?.message.includes('请输入有效的 number') === true,
      '错误格式重新输入',
    );
    await controller.line('7');
    await waitFor(() => original.input?.type === 'boolean', '布尔输入');
    await controller.line('false');
    await waitFor(() => !original.task, '完整交互命令');
    assert(original.lines.some((line) => line.includes('INPUT_RESULT:first name:7:false')));
    model.switch(second.id);
    await controller.key({ name: 'c', sequence: '\x03', ctrl: true });
    await waitFor(() => !second.task, 'Ctrl+C 返回取消元组');
    assert(
      second.lines.some((line) => line.includes('INPUT_ERROR:InvocationInputError:cancelled')),
    );
    await controller.global('run 2 ask');
    await waitFor(() => Boolean(second.input), '终端插件输入');
    await controller.line('12');
    await waitFor(() => !second.task, '终端插件输入完成');
    assert(second.lines.some((line) => line.includes('LOCAL_RESULT:12')));
    await controller.global('run 2 ask');
    await waitFor(() => Boolean(second.input), '终端插件等待取消');
    await controller.key({ name: 'c', sequence: '\x03', ctrl: true });
    await waitFor(() => !second.task, '终端插件取消输入完成');
    assert(second.lines.some((line) => line.includes('LOCAL_ERROR:cancelled')));
    await controller.global('run 2 relay-ask');
    await waitFor(() => Boolean(second.input), '嵌套核心输入');
    await controller.key({ name: 'c', sequence: '\x03', ctrl: true });
    await waitFor(() => !second.task, '嵌套核心取消输入完成');
    assert(second.lines.some((line) => line.includes('RELAY_INPUT_DONE')));
    await controller.global('run 1 smoke background 3000');
    await waitFor(() => original.task?.status === 'background', '主动忙覆盖函数返回');
    await controller.global('run 2 smoke quick');
    await waitFor(
      () => !second.task && second.lines.some((line) => line.includes('QUICK_DONE')),
      '并发窗口执行',
    );
    assert(original.task, '其他窗口完成不能撤销当前窗口主动忙');
    assert(original.lines.some((line) => line.includes('OWNERSHIP:' + original.id)));
    assert(!second.lines.some((line) => line.includes('OWNERSHIP:' + original.id)));
    await controller.global('run 1 smoke quick');
    assert(model.confirmation);
    await controller.line(':n');
    assert(original.task);
    await controller.global('run 1 smoke quick');
    await controller.line(':y');
    await waitFor(() => !original.task, '确认替换并协作取消');
    await controller.global('run 2 relay');
    await waitFor(
      () => !second.task && second.lines.some((line) => line.includes('RELAY_DONE')),
      '终端插件与核心子执行',
    );
    await controller.global('run 1 smoke late');
    await waitFor(() => !original.task, '延迟日志函数返回');
    await controller.global('c 1');
    const replacement = model.newWindow();
    assert.notEqual(replacement.id, original.id);
    assert.equal(replacement.number, 1);
    await waitFor(
      () => model.output.lines.some((line) => line.includes('LATE_OUTPUT')),
      '关闭窗口后迟到日志',
    );
    assert(!replacement.lines.some((line) => line.includes('LATE_OUTPUT')));
    await controller.global('run 2 smoke hold');
    await waitFor(() => replacement.task?.status === 'background', '不可协作后台任务');
    await controller.global('run 2 smoke quick');
    await controller.line(':y');
    assert(model.confirmation?.text.includes('整个插件进程'));
    await controller.line(':y');
    assert(model.panel?.lines.some((line) => /不可用|停止|未就绪/.test(line)));
    await waitFor(() => !replacement.task, '强停插件中断旧任务');
    assert(replacement.lines.some((line) => line.includes('interrupted')));
    const ids = model.windows.map((window) => window.id);
    await controller.lifecycle(true);
    await waitFor(() => controller.commands.some((info) => info.name === 'smoke'), '核心重启');
    assert.deepEqual(
      model.windows.map((window) => window.id),
      ids,
    );
    await store.save(model);
    const restored = await store.load();
    assert.deepEqual(
      restored.windows.map((window) => window.id),
      ids,
    );
    await controller.lifecycle(false);
    await core.waitClosed();
  } finally {
    await controller.dispose();
    await store.release();
  }

  const lineTerminal = spawn(executable, [], {
    cwd,
    env: { ...env, TERM: 'dumb', SCWC_TERMINAL_PERSIST: 'false' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lineClosed = once(lineTerminal, 'close');
  let lineOutput = '';
  lineTerminal.stdout.on('data', (chunk) => {
    lineOutput += chunk;
  });
  lineTerminal.stderr.on('data', (chunk) => {
    lineOutput += chunk;
  });
  try {
    await waitFor(() => lineOutput.includes('TERMINAL_CORE_READY'), '逐行终端启动');
    await new Promise((resolve) => setTimeout(resolve, 100));
    lineTerminal.stdin.write('smoke input\npipe name\ninvalid\n11\nfalse\n');
    await waitFor(
      () => lineOutput.includes('INPUT_RESULT:pipe name:11:false'),
      '预先输入的管道回复',
    );
    assert(!lineOutput.includes('未知命令: pipe'), '回复不能作为新命令执行');
    lineTerminal.stdin.end('smoke input\n');
    await waitFor(
      () => lineOutput.includes('INPUT_ERROR:InvocationInputError:closed'),
      '输入流关闭返回错误元组',
    );
    lineTerminal.kill('SIGTERM');
    const [exitCode, signal] = await lineClosed;
    if (process.platform === 'win32') {
      // Node terminates Windows children directly; SIGTERM is not a catchable signal there.
      assert.equal(signal, 'SIGTERM', lineOutput);
    } else {
      assert.equal(exitCode, 0, lineOutput);
    }
  } finally {
    if (lineTerminal.exitCode === null) {
      lineTerminal.kill('SIGKILL');
    }
    await lineClosed;
  }

  if (process.platform !== 'win32') {
    const driver = path.join(deployment, 'pty-smoke.py');
    await fs.writeFile(
      driver,
      String.raw`import os,sys,pty,fcntl,termios,struct,subprocess,select,time,signal,json
exe,cwd=sys.argv[1:3]
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,100,0,0))
color_env={**os.environ,'TERM':'xterm-256color'}
color_env.pop('FORCE_COLOR',None); color_env.pop('NO_COLOR',None)
p=subprocess.Popen([exe],stdin=slave,stdout=slave,stderr=slave,cwd=cwd,env=color_env)
os.close(slave)
buffer=b''
def until(text,timeout=15):
 global buffer
 deadline=time.time()+timeout
 while text.encode() not in buffer:
  if time.time()>deadline:
   import re
   raise Exception('PTY timeout: '+text+'\n'+re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', buffer.decode('utf8','replace'))[-1800:])
  if select.select([master],[],[],.1)[0]:
   try: buffer+=os.read(master,65536)
   except OSError: raise Exception('PTY closed before '+text)
def send(data): os.write(master,data)
try:
 until('TERMINAL_CORE_READY')
 send(b'\tismoke input\r')
 until('INPUT_NAME?')
 send(b'pty name\r')
 until('INPUT_COUNT?')
 send(b'bad\r')
 until('请输入有效的 number')
 send(b'9\r')
 until('INPUT_CONFIRMED?')
 send(b'false\r')
 until('INPUT_RESULT:pty name:9:false')
 time.sleep(.15)
 send(b'smoke color\r')
 until('CORE_COLOR_DONE')
 assert b'\x1b[34m[smoke]\x1b[39m' in buffer
 assert b'\x1b[33m[smoke] [warn]\x1b[39m' in buffer
 assert b'\x1b[31m[smoke] [error]\x1b[39m' in buffer
 assert b'\x1b[35mmagenta\x1b[39m' in buffer
 assert b'\x1b[33mtrue\x1b[39m' in buffer
 assert b'CORE_COLOR_LEVEL:0' not in buffer
 time.sleep(.15)
 send(b'colors\r')
 until('TERMINAL_COLOR_DONE')
 assert b'\x1b[33mTERMINAL_COLOR_WARNING\x1b[39m' in buffer
 assert b'\x1b[31mTERMINAL_COLOR_ERROR\x1b[39m' in buffer
 assert b'TERMINAL_COLOR_LEVEL:0' not in buffer
 time.sleep(.15)
 buffer=b''
 send(b'smoke input cancel\r')
 until('INPUT_NAME?cancel')
 send(b'\x03')
 until('INPUT_ERROR:InvocationInputError:cancelled')
 time.sleep(.15)
 send(b'smoke quick\r')
 until('QUICK_DONE')
 time.sleep(.1)
 send(b'\x1b[<0;3;1M:new\r')
 until('cmd2')
 send(b'\x1bismoke background 3000\r')
 until('FUNCTION_RETURNING')
 send(b'\x1b:q\r')
 until('是否确认退出')
 send(b':n\r')
 time.sleep(.1)
 fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',12,48,0,0)); p.send_signal(signal.SIGWINCH)
 buffer=b''
 send(b'\x1b:\r')
 until('是否确认退出')
 send(b':y\r')
 deadline=time.time()+15
 while p.poll() is None and time.time()<deadline:
  if select.select([master],[],[],.1)[0]:
   try: buffer+=os.read(master,65536)
   except OSError: break
 if p.poll() is None:
  import re
  raise Exception('PTY exit timeout: '+re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', buffer.decode('utf8','replace'))[-1400:])
 p.wait(timeout=1)
 assert p.returncode==0
 assert b'\x1b[?1049l' in buffer
 assert b'\x1b[?1006l' in buffer
 print('PTY full-screen, input, confirmation, resize and orderly exit passed')
finally:
 if p.poll() is None: p.kill(); p.wait()
 os.close(master)
`,
    );
    const driverChild = spawn(
      process.env.SCWC_TEST_PYTHON ?? 'python3',
      [driver, executable, cwd],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let result = '';
    driverChild.stdout?.on('data', (chunk) => {
      result += chunk;
    });
    driverChild.stderr?.on('data', (chunk) => {
      result += chunk;
    });
    const [code] = await once(driverChild, 'close');
    assert.equal(code, 0, result);
    console.log(result.trim());
    const state = JSON.parse(
      await fs.readFile(path.join(deployment, 'data/terminal/state.json'), 'utf8'),
    );
    assert.equal(state.windows.length, 3);
    assert(
      state.windows.some((window: { history: string[] }) => window.history.includes('smoke quick')),
    );
  }
  console.log(
    '终端集成验证通过：并发窗口日志、主动后台任务、替换确认、取消/强停、终端插件子调用、重启及状态保存。',
  );
}
