import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

const executable = fileURLToPath(
  new URL(
    '../../../dist/core/' + (process.platform === 'win32' ? 'scwc.exe' : 'scwc'),
    import.meta.url,
  ),
);
let directory: string;
let deployed: string;
beforeAll(async () => {
  if (!existsSync(executable)) {
    return;
  }
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-launch-'));
  deployed = path.join(directory, path.basename(executable));
  await fs.copyFile(executable, deployed);
  if (process.platform !== 'win32') {
    await fs.chmod(deployed, 0o755);
  }
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await fs.writeFile(
    path.join(directory, '.env'),
    `PORT=${port}\nTOKEN=null\nREDIS_ENABLED=false\nSCWC_TERMINAL_STATE_FILE=./state.json\n`,
  );
}, 30_000);
afterAll(async () => {
  if (directory) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe.skipIf(!existsSync(executable))('standalone executable launch mode', () => {
  it.each([
    { args: [], input: ':new\n:q\n', terminal: true },
    { args: ['--no-terminal'], input: 'exit\n', terminal: false },
  ])(
    'runs the expected mode with $args and exits cleanly',
    async (mode) => {
      const state = path.join(directory, 'state.json');
      await fs.rm(state, { force: true });
      const child = spawn(deployed, mode.args, {
        cwd: directory,
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          SCWC_RUNTIME_ROOT: undefined,
          TERM: 'dumb',
          FORCE_COLOR: '0',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        output += String(chunk);
      });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 35_000);
      try {
        const completion = new Promise<number | null>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', (code) => resolve(code));
        });
        child.stdin.end(mode.input);
        expect(await completion, output).toBe(0);
        if (mode.terminal) {
          const saved = JSON.parse(await fs.readFile(state, 'utf8')) as { windows: unknown[] };
          expect(saved.windows).toHaveLength(3);
        } else {
          expect(existsSync(state)).toBe(false);
          expect(output).not.toContain('未知命令');
        }
      } finally {
        clearTimeout(timeout);
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }
    },
    40_000,
  );
});
