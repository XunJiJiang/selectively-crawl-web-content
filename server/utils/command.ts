/**
 * 命令行指令处理模块
 */

type TCommandOption = {
  name: string;
  alias?: string;
  description?: string;
  required?: boolean; // 默认 false
  defaultValue?: string | boolean | number;
};

type TCommandCallback = (
  log: SCWC.Log,
  options: (TCommandOption & { value: string | boolean | number })[], // 包含值的选项数组
  // 未使用的参数部分的数组
  unusedArgs: string[],
  // 原始命令参数数组
  originArgs: string[]
) => void;

type TSubCommand = {
  name: string;
  description?: string;
  exampleUsage?: string;
  callback: TCommandCallback;
};

/**
 * 命令字典
 * [pluginId:]commandName -> Command Definition
 * 只有冲突时才会添加 pluginId 前缀
 */
const commandRegistry = new Map<
  string,
  {
    log: SCWC.Log;
    callback: TCommandCallback;
    description?: string;
    subCommands: TSubCommand[];
    options: TCommandOption[];
    exampleUsage?: string;
    pluginId: string;
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
const reservedCommands = new Set<string>(['exit', 'help', 'plugin:list', 'plugin:ps']);
/** 预留系统标志 */
export const SYSTEM_SYMBOL = Symbol('system');

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

// 和 registerCommand 类型略有不同, 这个是插件实际调用的类型
// 由 registerCommand 包装后暴露给插件使用
export type TRegisterCommand = (
  callback: TCommandCallback,
  description?: string,
  subCommands?: TSubCommand[],
  options?: TCommandOption[],
  exampleUsage?: string
) => void;

/**
 * 注册命令
 * 限制每个插件只能注册一个命令
 * @param log 日志对象
 * @param commandName 命令名称
 * @param callback 命令回调
 * @param pluginId 插件 ID
 * @param description 命令描述
 * @param subCommands 子命令
 * @param options 命令选项
 * @param exampleUsage 示例用法
 * @throws {Error} 如果命令名称非法或多次注册命令
 */
export function registerCommand(
  log: SCWC.Log,
  commandName: string,
  callback: TCommandCallback,
  pluginId: string | symbol,
  description?: string,
  subCommands?: TSubCommand[],
  options?: TCommandOption[],
  exampleUsage?: string
) {
  if (reservedCommands.has(commandName) && pluginId !== SYSTEM_SYMBOL) {
    throw new CommandError(`命令名称 ${commandName} 为系统预留命令`);
  }

  if (!reservedCommands.has(commandName) && !isValidCommandName(commandName)) {
    throw new CommandError(`包含非法字符，只能包含字母、数字、"-"、"_"`);
  }

  if (pluginCommandMap.has(pluginId.toString())) {
    throw new CommandError(`插件 ${pluginId.toString()} 已经注册命令 ${pluginCommandMap.get(pluginId.toString())}`);
  }

  if (commandPluginMap.has(commandName)) {
    // 添加命令前缀避免冲突
    // 之前的命令也添加前缀
    // 如果 existingPluginIds 的长度大于1，说明已经有多个插件占用了该命令, 且已经添加过前缀
    // 如果长度为1，说明是第一次冲突, 需要先给之前的插件添加前缀
    const existingPluginIds = commandPluginMap.get(commandName)!;

    if (existingPluginIds.length === 1) {
      const existingPluginId = existingPluginIds[0];
      const existingCommandName = `${existingPluginId.toString()}:${commandName}`;
      const commandDef = commandRegistry.get(commandName)!;
      // 从命令字典中删除旧的命令名称
      commandRegistry.delete(commandName);
      // 使用带前缀的新命令名称重新注册
      commandRegistry.set(existingCommandName, commandDef);
      // 更新 pluginCommandMap
      pluginCommandMap.set(existingPluginId, existingCommandName);
      commandDef.log.warn(`命令名称 ${commandName} 被重复注册，添加前缀 ${existingPluginId.toString()}: 以避免冲突`);
    }

    // 当前命令也添加前缀
    commandName = `${pluginId.toString()}:${commandName}`;
    log.warn(`命令名称 ${commandName} 重复注册，添加前缀 ${pluginId.toString()}: 以避免冲突`);
  }

  // 获取当前命令已被哪些插件占用
  const existingPluginIds = commandPluginMap.get(commandName) ?? [];
  // 记录当前插件占用该命令
  existingPluginIds.push(pluginId.toString());
  if (!reservedCommands.has(commandName)) {
    commandPluginMap.set(commandName, existingPluginIds);
    // 更新命令插件映射
    pluginCommandMap.set(pluginId.toString(), commandName);
  }
  // 注册命令
  commandRegistry.set(commandName, {
    log,
    callback,
    description,
    subCommands: subCommands ?? [],
    options: options ?? [],
    exampleUsage,
    pluginId: pluginId.toString(),
  });
}

/**
 * 解析命令行指令并执行
 * 只执行一个回调, 优先级: 子命令 > 主命令
 * @param originCommand 原始命令字符串
 */
export function parseAndRunCommands(originCommand: string) {
  const parts = originCommand.split(' ').filter(part => part.trim() !== '');
  const commandName = parts[0];
  /** 删除一级命令名称的参数数组 */
  const args = parts.slice(1);
  /**
   * 未使用的参数
   * 包括除去主命令和子命令名称和所有注册参数之外的参数
   */
  const unusedArgs: string[] = parts.slice(2).filter(arg => arg.startsWith('-'));
  // 备份原始参数数组
  const originArgs = parts.slice(0);
  if (!commandRegistry.has(commandName)) {
    throw new CommandError(`未知命令: ${commandName}`);
  }
  const commandDef = commandRegistry.get(commandName)!;
  const log = commandDef.log;
  // 解析选项
  const options: Record<string, string | boolean | number> = {};
  // 输入的选项部分
  const optionParts = args.filter(arg => arg.startsWith('-'));

  for (let i = 0; i < optionParts.length; i++) {
    const part = optionParts[i];
    let optionName: string;
    let optionValue: string | boolean | number | undefined = void 0;
    // 有没有输入值(=)
    const equalIndex = part.indexOf('=');
    // 有值
    if (equalIndex !== -1) {
      optionName = part.slice(0, equalIndex);
      optionValue = part.slice(equalIndex + 1);

      // 尝试转换为数字或布尔值
      if (!isNaN(Number(optionValue))) {
        optionValue = Number(optionValue);
      } else if (optionValue.toLowerCase() === 'true') {
        optionValue = true;
      } else if (optionValue.toLowerCase() === 'false') {
        optionValue = false;
      }
    } else {
      optionName = part;
    }
    // 去除前缀
    if (optionName.startsWith('--')) {
      // 长选项
      optionName = optionName.slice(2);
    } else {
      // 短选项
      optionName = optionName.slice(1);
      // 查找对应的长选项名称
      const optionDef = commandDef.options.find(opt => opt.alias === optionName);
      if (optionDef) {
        optionName = optionDef.name;
      } else {
        unusedArgs.push(part);
      }
    }
    const optionDef = commandDef.options.find(opt => opt.name === optionName);
    if (!optionDef) {
      log.warn(`未知选项: ${part}，已忽略`);
      continue;
    }
    if (optionDef.required) {
      if (optionValue === void 0) {
        log.error(`选项 ${part} 需要一个值`);
        return;
      }
    } else {
      // 不需要值，视为布尔值 true
      optionValue = optionValue === void 0 ? true : optionValue;
    }
    options[optionName] = optionValue;
  }

  // 检查必填选项
  for (const opt of commandDef.options) {
    if (opt.required && !(opt.name in options)) {
      log.error(`缺少必填选项: --${opt.name}`);
      return;
    } else {
      // 如果没有提供值，设置为默认值或 false
      if (!(opt.name in options)) {
        if (opt.defaultValue !== void 0) {
          options[opt.name] = opt.defaultValue;
        } else {
          options[opt.name] = false;
        }
      }
    }
  }

  // 填充默认值
  commandDef.options.forEach(opt => {
    if (!(opt.name in options)) {
      if (opt.defaultValue !== void 0) {
        options[opt.name] = opt.defaultValue;
      } else {
        options[opt.name] = false;
      }
    }
  });

  // 是否执行了子命令
  let executedSubCommand = false;
  // 检查是否有子命令
  // 获取第一个非选项参数
  const nonOptionArgs = args.filter(arg => !arg.startsWith('-'));

  if (nonOptionArgs.length > 0) {
    const subCommandName = nonOptionArgs[0];
    const subCommand = commandDef.subCommands.find(sub => sub.name === subCommandName);
    if (subCommand) {
      // 执行子命令回调
      subCommand.callback(
        commandDef.log,
        commandDef.options.map(opt => ({ ...opt, value: options[opt.name] })),
        unusedArgs,
        originArgs
      );
      executedSubCommand = true;
    }
  }
  if (!executedSubCommand) {
    // 第二个命令不是注册的子命令时，将这个命令参数加入未使用参数列表的第一项
    if (nonOptionArgs.length > 0) {
      unusedArgs.unshift(nonOptionArgs[0]);
    }

    // 执行命令回调
    commandDef.callback(
      commandDef.log,
      commandDef.options.map(opt => ({ ...opt, value: options[opt.name] })),
      unusedArgs,
      originArgs
    );
  }
  console.log(''); // 命令执行完后换行
}

/** 打印 help */
export function printHelp(log: SCWC.Log) {
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
  if (!commandRegistry.has(commandName)) {
    throw new CommandError(`未知命令: ${commandName}`);
  }
  const commandDef = commandRegistry.get(commandName)!;
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
    commandDef.options.forEach(opt => {
      log.info(
        `  --${opt.name}${opt.alias ? ` (-${opt.alias})` : ''}${opt.required ? ' [必填]' : ''}${
          opt.defaultValue !== undefined ? ` [默认值: ${opt.defaultValue}]` : ''
        } - ${opt.description ?? '无描述'}`
      );
    });
  }
  if (commandDef.subCommands.length > 0) {
    log.info('子命令:');
    commandDef.subCommands.forEach(sub => {
      log.info(`  ${sub.name} - ${sub.description ?? '无描述'}`);
      if (sub.exampleUsage) {
        log.info(`    示例用法: ${sub.exampleUsage}`);
      }
    });
  }
}
