import readline from 'node:readline';
import { pluginDirectorySettings } from './config.ts';

type DirectorySettings = ReturnType<typeof pluginDirectorySettings>;

export async function resolvePluginDirectory(
  settings: DirectorySettings,
  confirm: () => Promise<boolean> = confirmOverride,
): Promise<string> {
  if (!settings.commandDirectory) {
    return settings.directory;
  }
  if (settings.needsConfirmation && !(await confirm())) {
    return settings.directory;
  }
  return settings.commandDirectory;
}

function confirmOverride(): Promise<boolean> {
  console.warn('环境中的 SCWC_PLUGIN_DIR 将会被覆盖');
  console.log('是否确认覆盖？输入 y 确认，其他输入取消：');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.once('line', (line) => {
      resolve(line.trim().toLowerCase() === 'y');
      rl.close();
    });
    rl.once('close', () => resolve(false));
  });
}
