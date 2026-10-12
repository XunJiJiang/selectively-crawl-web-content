import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvironment } from './environment.ts';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('environment file priority', () => {
  it('retains bootstrap directories while still applying public configuration', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-env-'));
    directories.push(directory);
    fs.writeFileSync(
      path.join(directory, '.env'),
      'PORT=4100\nSCWC_APP_DIR=wrong\nSCWC_RUNTIME_ROOT=wrong\nSCWC_DISTRIBUTION_MODE=wrong\n',
    );
    const env = {
      PORT: '4200',
      SCWC_APP_DIR: '/release',
      SCWC_RUNTIME_ROOT: '/release/runtime',
      SCWC_DISTRIBUTION_MODE: 'external-node',
    };
    loadEnvironment(directory, env);
    expect(env).toEqual({
      PORT: '4100',
      SCWC_APP_DIR: '/release',
      SCWC_RUNTIME_ROOT: '/release/runtime',
      SCWC_DISTRIBUTION_MODE: 'external-node',
    });
  });
  it('prefers adjacent .env values and retains unspecified environment variables', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-env-'));
    directories.push(directory);
    fs.writeFileSync(
      path.join(directory, '.env'),
      'PORT=4100\nREDIS_PASSWORD="p@ss:/?#%"\nREDIS_KEY_PREFIX=local\n',
    );
    const env = { PORT: '4200', HOST: 'http://example.test', REDIS_PASSWORD: 'old' };
    loadEnvironment(directory, env);
    expect(env).toEqual({
      PORT: '4100',
      HOST: 'http://example.test',
      REDIS_PASSWORD: 'p@ss:/?#%',
      REDIS_KEY_PREFIX: 'local',
    });
  });
  it('retains process environment when no file exists', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-env-'));
    directories.push(directory);
    const env = { PORT: '4200' };
    loadEnvironment(directory, env);
    expect(env).toEqual({ PORT: '4200' });
  });
});
