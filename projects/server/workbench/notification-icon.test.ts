import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { notificationIconFile } from './notification-icon.ts';

it('loads the notification PNG from source and an isolated packaged runtime', async () => {
  const png = await fs.readFile(notificationIconFile());
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([256, 256]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-notification-asset-'));
  try {
    const runtime = path.join(directory, 'runtime');
    await fs.mkdir(path.join(runtime, 'public/resources'), { recursive: true });
    await fs.writeFile(path.join(runtime, 'public/resources/notification.png'), png);
    const bundled = path.join(runtime, 'notification-icon.cjs');
    await build({
      entryPoints: [import.meta.filename.replace('.test.ts', '.ts')],
      outfile: bundled,
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
      define: { 'import.meta.url': JSON.stringify('file:///scwc/bundle.cjs') },
    });
    const output = execFileSync(
      process.execPath,
      [
        '--eval',
        `const {notificationIconFile}=require(${JSON.stringify(bundled)});process.stdout.write(require('node:fs').readFileSync(notificationIconFile()));`,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          NODE_PATH: '',
          SCWC_DISTRIBUTION_MODE: 'external-node',
          SCWC_APP_DIR: directory,
          SCWC_RUNTIME_ROOT: runtime,
        },
      },
    );
    expect(output).toEqual(png);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
