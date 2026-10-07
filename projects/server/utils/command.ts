/**
 * 命令行指令处理模块
 */

import { EventEmitter } from 'node:events';
import { bindLogger } from './log.ts';
import { currentIdentity, invocationStorage, taskRegistry } from '../common/tasks.ts';
import type { InvocationContext } from '../types/task.d.ts';
import type { TLogger } from '../types/log.d.ts';
import type { TCommandExecute, TCommandOption, TSubCommand } from '../types/command.d.ts';

/**
 * 命令字典
 * [pluginId:]commandName -> Command Definition
 * 只有冲突时才会添加 pluginId 前缀
 */
export const commandEvents = new EventEmitter();

const commandRegistry = new Map<
  string,
  {
    log: TLogger;
    execute: TCommandExecute;
    description?: string;
    subCommands: TSubCommand[];
    options: TCommandOption[];
    exampleUsage?: string;
    pluginId: string;
    available?: () => boolean;
  }
>();

/**
 * 由 pluginId 指向真实命令名称的映射
 * pluginId -> [pluginId:]commandName
 * 系统命令不记录
 */
const pluginCommandMap = new Map<string, string>();

/**
 * commandName -> pluginId[]
 * 此处记录原始命令名称, 不包含前缀
 * 系统命令不记录
 */
const commandPluginMap = new Map<string, string[]>();

/** 检查命令有没有非法字符 */
function isValidCommandName(name: string) {
  return /^[a-zA-Z0-9-_]+$/.test(name);
}

/** 预留命令 */
const reservedCommands = new Set<string>();
/** 预留系统标志 */
export const SYSTEM_SYMBOL = Symbol('system');

export class CommandError extends Error {
  constructor(message: string, needPrintOriginal = true) {
    super(message);
    this.name = 'CommandError';
    this.needPrintOriginal = needPrintOriginal;
  }

  /** 是否需要打印原始错误 */
  public needPrintOriginal = true;
}

// 和 registerCommand 类型略有不同, 这个是插件实际调用的类型
// 由 registerCommand 包装后暴露给插件使用
export type TRegisterCommand = (
  execute: TCommandExecute,
  description?: string,
  subCommands?: TSubCommand[],
  options?: TCommandOption[],
  exampleUsage?: string,
) => void;

/**
 * 注册命令
 * 限制每个插件只能注册一个命令
 * @param log 日志对象
 * @param commandName 命令名称
 * @param execute 命令回调
 * @param pluginId 插件 ID
 * @param description 命令描述
 * @param subCommands 子命令
 * @param options 命令选项
 * @param exampleUsage 示例用法
 * @throws {Error} 如果命令名称非法或多次注册命令
 */
export function registerCommand(
  log: TLogger,
  commandName: string,
  execute: TCommandExecute,
  pluginId: string | symbol,
  description?: string,
  subCommands?: TSubCommand[],
  options?: TCommandOption[],
  exampleUsage?: string,
  available?: () => boolean,
) {
  if (reservedCommands.has(commandName) && pluginId !== SYSTEM_SYMBOL) {
    throw new CommandError(`命令名称 ${commandName} 为系统预留命令`, false);
  } else if (pluginId === SYSTEM_SYMBOL && !reservedCommands.has(commandName)) {
    // 使用系统符号注册的命令添加到预留命令列表中
    reservedCommands.add(commandName);
  }

  if (!reservedCommands.has(commandName) && !isValidCommandName(commandName)) {
    throw new CommandError(`包含非法字符，只能包含字母、数字、"-"、"_"`, false);
  }

  if (pluginCommandMap.has(pluginId.toString())) {
    throw new CommandError(
      `插件 ${pluginId.toString()} 已经注册命令 ${pluginCommandMap.get(pluginId.toString())}`,
      false,
    );
  }

  const existingPluginIds = commandPluginMap.get(commandName);
  if (existingPluginIds) {
    // 添加命令前缀避免冲突
    // 之前的命令也添加前缀
    // 如果 existingPluginIds 的长度大于1，说明已经有多个插件占用了该命令, 且已经添加过前缀
    // 如果长度为1，说明是第一次冲突, 需要先给之前的插件添加前缀

    if (existingPluginIds.length === 1) {
      const existingPluginId = existingPluginIds[0];
      const existingCommandName = `${existingPluginId.toString()}:${commandName}`;
      const commandDef = commandRegistry.get(commandName);
      if (commandDef) {
        // 从命令字典中删除旧的命令名称
        commandRegistry.delete(commandName);
        // 使用带前缀的新命令名称重新注册
        commandRegistry.set(existingCommandName, commandDef);
        // 更新 pluginCommandMap
        pluginCommandMap.set(existingPluginId, existingCommandName);
        commandDef.log.warn(
          `命令名称 ${commandName} 被重复注册，添加前缀 ${existingPluginId.toString()}: 以避免冲突`,
        );
      }
    }

    // 当前命令也添加前缀
    commandName = `${pluginId.toString()}:${commandName}`;
    log.warn(`命令名称 ${commandName} 重复注册，添加前缀 ${pluginId.toString()}: 以避免冲突`);
  }

  // 获取当前命令已被哪些插件占用
  const existingPluginIdsNotVoid = existingPluginIds ?? [];
  // 记录当前插件占用该命令
  existingPluginIdsNotVoid.push(pluginId.toString());
  if (!reservedCommands.has(commandName)) {
    commandPluginMap.set(commandName, existingPluginIdsNotVoid);
    // 更新命令插件映射
    pluginCommandMap.set(pluginId.toString(), commandName);
  }
  // 注册命令
  commandRegistry.set(commandName, {
    log,
    execute,
    description,
    subCommands: subCommands ?? [],
    options: options ?? [],
    exampleUsage,
    available,
    pluginId: pluginId.toString(),
  });
  commandEvents.emit('change', getCommands());
}

/**
 * 解析并拆分源命令
 * 主要是为了处理带引号的参数
 * @param rawCommand 原始命令字符串
 * @returns 拆分后的命令数组
 */
export function splitCommand(rawCommand: string): string[] {
  const parts: string[] = [];
  let token = '';
  let quote = '';
  let started = false;
  for (let i = 0; i < rawCommand.length; i++) {
    const character = rawCommand[i];
    if (quote) {
      if (character === quote) {
        quote = '';
      } else if (character === '\\' && rawCommand[i + 1] === quote) {
        token += rawCommand[++i];
      } else {
        token += character;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) {
        parts.push(token);
        token = '';
        started = false;
      }
    } else {
      token += character;
      started = true;
    }
  }
  if (quote) {
    throw new CommandError('命令引号未闭合', false);
  }
  if (started) {
    parts.push(token);
  }
  return parts;
}

/**
 * 解析命令行指令并执行
 * 只执行一个回调, 优先级: 子命令 > 主命令
 * @param originCommand 原始命令字符串
 */
export function getCommands() {
  return [...commandRegistry].map(([name, value]) => ({
    name,
    description: value.description,
    subCommands: value.subCommands.map((item) => item.name),
  }));
}

function prepareCommand(raw: string) {
  const parts = splitCommand(raw);
  if (!parts.length) {
    throw new CommandError('未提供命令', false);
  }
  const definition = commandRegistry.get(parts[0]);
  if (!definition) {
    throw new CommandError(`未知命令: ${parts[0]}`, false);
  }
  if (definition.available && !definition.available()) {
    throw new CommandError('命令所属插件已停止，请使用 :r 重启核心后重新提交', false);
  }
  const options = new Map(
    definition.options.map((option) => [
      option.name,
      { ...option, value: option.defaultValue ?? false },
    ]),
  );
  const provided = new Set<string>();
  const positional: string[] = [];
  const warnings: string[] = [];
  let literal = false;
  for (const part of parts.slice(1)) {
    if (part === '--') {
      literal = true;
      continue;
    }
    if (literal || !part.startsWith('-')) {
      positional.push(part);
      continue;
    }
    const split = part.indexOf('=');
    const key = part.slice(0, split < 0 ? undefined : split).replace(/^-+/, '');
    const option = definition.options.find((item) => item.name === key || item.alias === key);
    if (!option) {
      warnings.push(`未知选项: ${part}，已忽略`);
      continue;
    }
    if (option.required && split < 0) {
      throw new CommandError(`选项 ${part} 需要一个值`, false);
    }
    const text = split < 0 ? undefined : part.slice(split + 1);
    const value =
      text === undefined
        ? true
        : text === 'true'
          ? true
          : text === 'false'
            ? false
            : text.trim() && Number.isFinite(Number(text))
              ? Number(text)
              : text;
    options.set(option.name, { ...option, value });
    provided.add(option.name);
  }
  for (const option of definition.options) {
    if (option.required && !provided.has(option.name)) {
      throw new CommandError(`缺少必填选项: --${option.name}`, false);
    }
  }
  const sub = definition.subCommands.find((item) => item.name === positional[0]);
  return {
    definition,
    parts,
    execute: sub?.execute ?? definition.execute,
    options: [...options.values()],
    unused: sub ? positional.slice(1) : positional,
    warnings,
  };
}
export function validateCommand(command: string) {
  const prepared = prepareCommand(command);
  return { name: prepared.parts[0], pluginId: prepared.definition.pluginId };
}

export async function parseAndRunCommands(command: string, supplied?: InvocationContext) {
  const prepared = prepareCommand(command);
  const scope = supplied ? undefined : taskRegistry.create('core', currentIdentity());
  const context = supplied ?? scope?.context;
  if (!context) {
    throw new CommandError('调用上下文缺失');
  }
  const logger = bindLogger(prepared.definition.log, context, prepared.definition.pluginId);
  try {
    await invocationStorage.run(context, async () => {
      for (const warning of prepared.warnings) {
        logger.warn(warning);
      }
      await prepared.execute(logger, prepared.options, prepared.unused, prepared.parts, context);
      logger.info('=======================================================');
    });
  } finally {
    scope?.finish();
  }
}

/** 打印 help */
export function printHelp(log: TLogger) {
  log.info('可用命令列表:');
  for (const [commandName, commandDef] of commandRegistry.entries()) {
    log.info(`- ${commandName}${commandDef.description ? `: ${commandDef.description}` : ''}`);
  }
  log.info('使用 "help [命令名称]" 查看指定命令的帮助信息');
}

/**
 * 打印指定命令的 help
 * @param commandName 命令名称 [pluginId:]commandName
 */
export function printCommandHelp(commandName: string) {
  const commandDef = commandRegistry.get(commandName);
  if (!commandDef) {
    throw new CommandError(`未知命令: ${commandName}`, false);
  }
  const log = commandDef.log;

  log.info(`命令: ${commandName}`);
  if (commandDef.description) {
    log.info(`描述: ${commandDef.description}`);
  }
  if (commandDef.exampleUsage) {
    log.info(`示例用法: ${commandDef.exampleUsage}`);
  }
  if (commandDef.options.length > 0) {
    log.info('选项:');
    commandDef.options.forEach((opt) => {
      log.info(
        `  --${opt.name}${opt.alias ? ` (-${opt.alias})` : ''}${opt.required ? ' [必填]' : ''}${
          opt.defaultValue !== undefined ? ` [默认值: ${opt.defaultValue}]` : ''
        } - ${opt.description ?? '无描述'}`,
      );
    });
  }
  if (commandDef.subCommands.length > 0) {
    log.info('子命令:');
    commandDef.subCommands.forEach((sub) => {
      log.info(`  ${sub.name} - ${sub.description ?? '无描述'}`);
      if (sub.exampleUsage) {
        log.info(`    示例用法: ${sub.exampleUsage}`);
      }
    });
  }
}
