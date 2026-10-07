import { parseStartupArgs } from '../common/config.ts';
import { buildWebIfNeeded } from './build.ts';
import { startTerminal } from '../../terminal/index.ts';

const aliases: Record<string, string> = {
  '-m': '--mode',
  '-b': '--build',
  '-ut': '--use-tsx',
  '-wp': '--web-port',
  '-wh': '--web-host',
};
const args = process.argv.slice(2).map((arg) => {
  const separator = arg.indexOf('=');
  const key = separator < 0 ? arg : arg.slice(0, separator);
  return (aliases[key] ?? key) + (separator < 0 ? '' : arg.slice(separator));
});
const parsed = parseStartupArgs(args);
async function main() {
  const mode = typeof parsed.mode === 'string' ? parsed.mode : 'prod';
  await buildWebIfNeeded(parsed.build === true || parsed.build === 'true', mode);
  await startTerminal(args);
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
