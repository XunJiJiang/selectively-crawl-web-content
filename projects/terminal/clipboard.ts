import { spawn } from 'node:child_process';

function pipe(command: string, args: string[], text: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.once('error', reject);
    child.stdin.on('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error('剪贴板写入失败'))));
    child.stdin.end(text);
  });
}

export async function copyText(text: string, output: NodeJS.WriteStream) {
  const commands: [string, string[]][] =
    process.platform === 'darwin'
      ? [['pbcopy', []]]
      : process.platform === 'win32'
        ? [
            [
              'powershell.exe',
              ['-NoProfile', '-Command', '[Console]::In.ReadToEnd() | Set-Clipboard'],
            ],
          ]
        : [
            ['wl-copy', []],
            ['xclip', ['-selection', 'clipboard']],
            ['xsel', ['--clipboard', '--input']],
          ];
  for (const [command, args] of commands) {
    try {
      await pipe(command, args, text);
      return;
    } catch {
      /* Try the next clipboard provider. */
    }
  }
  // OSC 52 also works through SSH when the terminal permits clipboard writes.
  output.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
}
