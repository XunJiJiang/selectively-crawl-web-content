import { Chalk, type ColorSupportLevel } from 'chalk';
import { stripVTControlCharacters } from 'node:util';
import type { LogLevel } from '../utils/log.ts';

type ColorOutput = Pick<NodeJS.WriteStream, 'isTTY' | 'getColorDepth'>;
const palettes = [0, 1, 2, 3].map((level) => new Chalk({ level: level as ColorSupportLevel }));

export function outputColorLevel(
  env = process.env,
  output: ColorOutput = process.stdout,
): ColorSupportLevel {
  if (env.FORCE_COLOR !== undefined) {
    if (env.FORCE_COLOR === 'false' || env.FORCE_COLOR === '0') {
      return 0;
    }
    if (env.FORCE_COLOR === '' || env.FORCE_COLOR === 'true') {
      return 1;
    }
    const level = Number.parseInt(env.FORCE_COLOR, 10);
    if (Number.isFinite(level)) {
      return Math.max(0, Math.min(3, level)) as ColorSupportLevel;
    }
  }
  if (env.NO_COLOR !== undefined || env.TERM === 'dumb' || !output.isTTY) {
    return 0;
  }
  const depth = output.getColorDepth?.(env) ?? 4;
  return depth >= 24 ? 3 : depth >= 8 ? 2 : depth >= 4 ? 1 : 0;
}

/** Pipe-backed children inherit the real terminal's color capability. */
export function colorEnvironment(env = process.env): NodeJS.ProcessEnv {
  if (env.NO_COLOR !== undefined && env.FORCE_COLOR === undefined) {
    return { ...env };
  }
  return { ...env, FORCE_COLOR: String(outputColorLevel(env)) };
}

export function colorLogText(text: string, level?: LogLevel, colorLevel = outputColorLevel()) {
  if (!colorLevel) {
    return stripVTControlCharacters(text);
  }
  if (!level) {
    return text;
  }
  const palette = palettes[colorLevel];
  const paint = level === 'error' ? palette.red : level === 'warn' ? palette.yellow : palette.blue;
  // Keep custom body colors; default core logs color only their tag.
  const tag = /^(\[[^\]\n]+\](?: \[(?:warn|error)\])?)/.exec(text);
  return tag ? paint(tag[0]) + text.slice(tag[0].length) : paint(text);
}
