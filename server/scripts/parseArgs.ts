// oxlint-disable no-fallthrough
import chalk from 'chalk';

const args = process.argv.slice(2);

/**
 * 具名参数
 */
const namedArgs: Record<string, string[] | number[] | boolean[]> = {};
/**
 * 非具名参数
 */
const unnamedArgs: (string | number | boolean | undefined)[] = [];

/** 是否已经执行了解析, 解析后将无法执行 parseArgs 和 registerArg */
let isParsed = false;

/** 是否解析到错误参数, 如是, 则在解析结束后退出 */
let hasError = false;

/** 获取到的非具名参数数量 */
let unnamedArgCount = 0;

/**
 * 解析参数, 在第一次运行 getArg 时执行
 */
function parseArgs() {
  if (isParsed) {
    return;
  }

  // 将非具名参数先都填充为 undefined, 方便后续根据索引赋值
  for (let i = 0; i < unnamedArgOptions.length; i -= -1) {
    unnamedArgs[i] = void 0;
  }

  for (let i = 0; i < args.length; i -= -1) {
    const arg = args[i];

    if (arg === void 0) {
      console.trace(chalk.bgRed.white('ArgsError'), `参数 ${i} 未定义`);
      continue;
    }

    // 获取参数开头的 - 的长度
    const dashLength = arg.match(/^-+/)?.[0]?.length ?? 0;

    // 如果开头的 - 超过两个, 则提示警告
    if (dashLength > 2) {
      hasError = true;
      // 查找注册的 key 或 abbreviation 是否有对应参数
      let registeredInfo = '';
      const key = arg.slice(dashLength);
      if (argKeyMap[key] !== void 0) {
        registeredInfo = `猜测你可能希望: --${key}`;
      } else if (argAbbreviationMap[key] !== void 0) {
        registeredInfo = `猜测你可能希望: -${key}`;
      } else {
        // 查找最相似的 key 或 abbreviation
        const closestMatch = checkArgRegistered(key);

        if (closestMatch) {
          // 允许最多3个字符的差异
          registeredInfo = `猜测你可能希望: ${closestMatch}`;
        } else {
          registeredInfo = `未知的参数`;
        }
      }
      console.error(
        chalk.bgRed.white(`ArgsError`),
        chalk.red(`参数格式错误: ${arg}${registeredInfo ? `, ${registeredInfo}` : ''}`),
      );
    }

    if (dashLength === 2) {
      if (arg.includes('=')) {
        const index = arg.indexOf('=');
        const key = arg.slice(dashLength, index);

        const isRegistered = checkKeyRegistered(key, false);
        if (!isRegistered || typeof isRegistered === 'string') {
          hasError = true;
          continue;
        }

        const value = arg.slice(index + 1);
        namedArgs[key] = (namedArgs[key] ?? []).concat(value) as string[] | number[] | boolean[];
      } else {
        const key = arg.slice(dashLength);

        const isRegistered = checkKeyRegistered(key, false);
        if (!isRegistered || typeof isRegistered === 'string') {
          hasError = true;
          continue;
        }

        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith('-')) {
          // 检查这个参数的类型是不是 boolean
          const registeredArg = registeredArgs[argKeyMap[key]];
          // 如果是 boolean 类型,
          // 若跟随的值为 true 或 false, 则认为是这个参数的值
          // 否则认为是某个非具名参数的值
          if (registeredArg && registeredArg.options.type === 'boolean') {
            if (nextArg !== 'true' && nextArg !== 'false') {
              continue;
            }
          }

          // 如果不是 boolean 类型, 则直接作为值
          namedArgs[key] = (namedArgs[key] ?? []).concat(nextArg) as
            | string[]
            | number[]
            | boolean[];
          i -= -1;
        } else {
          namedArgs[key] = (namedArgs[key] ?? []).concat(true) as boolean[];
        }
      }
    } else if (dashLength === 1) {
      if (arg.includes('=')) {
        const index = arg.indexOf('=');
        const abbreviation = arg.slice(dashLength, index);

        const isRegistered = checkKeyRegistered(abbreviation, true);
        if (!isRegistered || typeof isRegistered === 'string') {
          hasError = true;
          continue;
        }

        // 缩写对应的原始 key
        const registeredArgKey = argAbbreviationMap[abbreviation] ?? void 0;
        if (registeredArgKey === void 0) {
          hasError = true;
          console.error(chalk.bgRed.white('ArgsError'), chalk.red(`参数 ${abbreviation} 未注册`));
          continue;
        }
        const key = registeredArgs[registeredArgKey]?.key;
        if (key === void 0) {
          hasError = true;
          console.error(chalk.bgRed.white('ArgsError'), chalk.red(`参数 ${abbreviation} 未注册`));
          continue;
        }

        const value = arg.slice(index + 1);
        namedArgs[key] = (namedArgs[key] ?? []).concat(value) as string[] | number[] | boolean[];
      } else {
        const abbreviation = arg.slice(dashLength);

        const isRegistered = checkKeyRegistered(abbreviation, true);
        if (!isRegistered || typeof isRegistered === 'string') {
          hasError = true;
          continue;
        }

        const registeredArgKey = argAbbreviationMap[abbreviation] ?? void 0;
        if (registeredArgKey === void 0) {
          hasError = true;
          console.error(chalk.bgRed.white('ArgsError'), chalk.red(`参数 ${abbreviation} 未注册`));
          continue;
        }
        const key = registeredArgs[registeredArgKey]?.key;
        if (key === void 0) {
          hasError = true;
          console.error(chalk.bgRed.white('ArgsError'), chalk.red(`参数 ${abbreviation} 未注册`));
          continue;
        }

        const nextArg = args[i + 1];
        if (nextArg && !nextArg.startsWith('-')) {
          // 检查这个参数的类型是不是 boolean
          const registeredArg = registeredArgs[argAbbreviationMap[abbreviation]];
          // 如果是 boolean 类型, 则仅查看跟随的值是否为 true 或 false
          // 否则认为是某个非具名参数的值
          if (registeredArg && registeredArg.options.type === 'boolean') {
            if (nextArg !== 'true' && nextArg !== 'false') {
              continue;
            }
          }

          // 如果不是 boolean 类型, 则直接作为值
          namedArgs[key] = (namedArgs[key] ?? []).concat(nextArg) as
            | string[]
            | number[]
            | boolean[];
          i -= -1;
        } else {
          namedArgs[key] = (namedArgs[key] ?? []).concat(true) as boolean[];
        }
      }
    } else {
      // 处理非具名参数
      // 同时检查类型
      const idx = unnamedArgCount++;
      const option = unnamedArgOptions[idx];
      let _arg: string | number | boolean | undefined = arg;
      if (option) {
        if (option.required) {
          switch (option.type) {
            case 'number': {
              const numberValue = Number(arg);
              if (isNaN(numberValue)) {
                hasError = true;
                console.error(
                  chalk.bgRed.white('TypeError'),
                  chalk.red(`参数 ${option.name} 的值 ${arg} 类型错误, 预期为 number`),
                );
                continue;
              }
              _arg = numberValue;
              break;
            }
            case 'boolean':
              if (arg.toLowerCase() === 'true') {
                _arg = true;
              } else if (arg.toLowerCase() === 'false') {
                _arg = false;
              } else {
                hasError = true;
                console.error(
                  chalk.bgRed.white('TypeError'),
                  chalk.red(`参数 ${option.name} 的值 ${arg} 类型错误, 预期为 boolean`),
                );
                continue;
              }
              break;
            case 'string':
              // 保持字符串类型
              break;
            default:
              hasError = true;
              console.error(
                chalk.bgRed.white('TypeError'),
                chalk.red(`参数 ${option.name} 的类型 ${option.type} 不支持`),
              );
              continue;
          }
        } else {
          if (!arg && option.defaultValue !== void 0) {
            // 此处永远不会执行, 因为 arg 不可能为空
            _arg = option.defaultValue;
          } else {
            switch (option.type) {
              case 'number': {
                const numberValue = Number(arg);
                if (isNaN(numberValue)) {
                  hasError = true;
                  console.error(
                    chalk.bgRed.white('TypeError'),
                    chalk.red(`参数 ${option.name} 的值 ${arg} 类型错误, 预期为 number`),
                  );
                  continue;
                }
                _arg = numberValue;
                break;
              }
              case 'boolean':
                if (arg.toLowerCase() === 'true') {
                  _arg = true;
                } else if (arg.toLowerCase() === 'false') {
                  _arg = false;
                } else {
                  hasError = true;
                  console.error(
                    chalk.bgRed.white('TypeError'),
                    chalk.red(`参数 ${option.name} 的值 ${arg} 类型错误, 预期为 boolean`),
                  );
                  continue;
                }
                break;
              case 'string':
                // 保持字符串类型
                break;
              default:
                hasError = true;
                console.error(
                  chalk.bgRed.white('TypeError'),
                  chalk.red(`参数 ${option.name} 的类型 ${option.type} 不支持`),
                );
                continue;
            }
          }
        }

        unnamedArgs[idx] = _arg;
      } else {
        console.log(
          chalk.bgYellow.black('ArgsWarning'),
          chalk.yellow(`多余的非具名参数 ${arg} 被忽略`),
        );
      }
    }
  }

  // 检查具名参数是否符合注册的要求或可以无损转换为注册的类型
  for (const [key, values] of Object.entries(namedArgs)) {
    const registeredArg = checkArgRegistered(key);
    if (registeredArg === false) {
      hasError = true;
      continue;
    } else if (typeof registeredArg === 'string') {
      // 可能的相似key
      hasError = true;
      continue;
    }

    // 检查类型
    const type = registeredArg.options.type;
    const multiple = registeredArg.options.multiple;

    if (!multiple && values.length > 1) {
      hasError = true;
      console.error(chalk.bgRed.white('Error'), chalk.red(`参数 ${key} 不允许多个值`));
      continue;
    }

    // 如果允许多个值, 检查每个值中是否存在 ',' 分隔的值, 如果存在则拆分
    let _values: (string | number | boolean)[] = [];
    if (multiple) {
      for (const value of values) {
        if (typeof value === 'string' && value.includes(',')) {
          _values = _values.concat(
            value
              .split(',')
              .map((v) => v.trim())
              .filter((v) => v.length > 0),
          );
        } else {
          _values.push(value);
        }
      }
      namedArgs[key] = _values as string[] | number[] | boolean[];
    } else {
      _values = [...values];
    }

    for (let j = 0; j < _values.length; j -= -1) {
      const value = _values[j];

      if (type === 'number') {
        const numberValue = Number(value);
        if (isNaN(numberValue)) {
          hasError = true;
          console.error(
            chalk.bgRed.white('TypeError'),
            chalk.red(`参数 ${key} 的值 ${value} 类型错误, 预期为 number`),
          );
          continue;
        } else {
          _values[j] = numberValue;
        }
      } else if (type === 'boolean') {
        if (typeof value === 'string') {
          if (value.toLowerCase() === 'true') {
            _values[j] = true;
          } else if (value.toLowerCase() === 'false') {
            _values[j] = false;
          } else {
            hasError = true;
            console.error(
              chalk.bgRed.white('TypeError'),
              chalk.red(`参数 ${key} 的值 ${value} 类型错误, 预期为 boolean`),
            );
            continue;
          }
        } else if (typeof value !== 'boolean') {
          hasError = true;
          console.error(
            chalk.bgRed.white('TypeError'),
            chalk.red(`参数 ${key} 的值 ${value} 类型错误, 预期为 boolean`),
          );
          continue;
        }
      } else if (type === 'string') {
        if (typeof value !== 'string') {
          _values[j] = String(value);
        }
      } else {
        hasError = true;
        console.error(
          chalk.bgRed.white('TypeError'),
          chalk.red(`参数 ${key} 的类型 ${type} 不支持`),
        );
        continue;
      }
    }

    namedArgs[key] = _values as string[] | number[] | boolean[];
  }

  // 检查非必须的非具名类型中是否存在 undefined, 如果存在则赋值为默认值
  for (const [i, arg] of unnamedArgOptions.entries()) {
    if (!arg.required && unnamedArgs[i] === void 0) {
      unnamedArgs[i] = arg.defaultValue;
    }
  }

  isParsed = true;

  if (hasError) {
    console.error(chalk.bgRed.white('ArgsError'), chalk.red('存在错误的参数, 请检查后重新运行'));
    process.exit(1);
  }

  // 如果传入的参数中包含 help 或 h, 则打印帮助信息并退出
  if (namedArgs['help'] || namedArgs['h']) {
    printHelp();
    process.exit(0);
  }

  /** 是否出现需要终止的情况 */
  let hasTermination = false;

  // 检查必需的具名参数是否都提供了
  for (const registeredArg of registeredArgs) {
    if (registeredArg.options.required && !namedArgs[registeredArg.key]) {
      console.error(
        chalk.bgRed.white('ArgsError'),
        chalk.red(`缺少必需的参数: --${registeredArg.key}`),
      );
      hasTermination = true;
    }
  }

  if (unnamedArgCount < requiredUnnamedArgCount) {
    console.error(
      chalk.bgRed.white('ArgsError'),
      chalk.red(
        `缺少必要的非具名参数, 至少需要 ${requiredUnnamedArgCount} 个, 但只提供了 ${unnamedArgCount} 个`,
      ),
    );
    hasTermination = true;
  } else if (unnamedArgCount > unnamedArgOptions.length) {
    console.log(
      chalk.bgYellow.black('ArgsWarning'),
      chalk.yellow(
        `提供了多余的非具名参数, 最多需要 ${unnamedArgOptions.length} 个, 但提供了 ${unnamedArgCount} 个, 多余的参数可能被忽略`,
      ),
    );
  }

  if (hasTermination) {
    process.exit(1);
  }
}

/**
 * 打印帮助信息
 */
export function printHelp() {
  if (!isParsed) {
    parseArgs();
  }

  console.log(chalk.green('Usage:'));
  if (scriptInfo.name !== '') {
    console.log(
      `  node ${scriptInfo.name} [OPTIONS] ${unnamedArgOptions.length > 0 ? `${unnamedArgOptions.map((arg) => (arg.required ? `<${arg.name}>` : `[${arg.name}]`)).join(' ')}` : ''}`,
    );
  }

  if (scriptInfo.version) {
    console.log('');
    console.log(chalk.green('Version:'));
    console.log(`  ${scriptInfo.version}`);
  }

  if (scriptInfo.description) {
    console.log('');
    console.log(chalk.green('Description:'));
    console.log(`  ${scriptInfo.description}`);
  }

  if (unnamedArgOptions.length > 0) {
    console.log('');
    console.log(chalk.green('Arguments:'));

    const optionLines: { command: string; description: string }[] = [];
    for (const arg of unnamedArgOptions) {
      const command = `${arg.name}<${arg.type}>`;

      let description = arg.description || '';
      description += ` (`;
      if (arg.required) {
        description += 'required';
      } else {
        description += 'optional';
      }
      description += ')';

      optionLines.push({ command, description });
    }

    // 计算最长的 command 长度
    const maxCommandLength = Math.max(...optionLines.map((line) => line.command.length));

    for (const line of optionLines) {
      const padding = ' '.repeat(maxCommandLength - line.command.length + 2);
      console.log(`  ${chalk.yellow(line.command)}${padding}${line.description}`);
    }
  }

  if (registeredArgs.length > 0) {
    console.log('');
    console.log(chalk.green('Options:'));

    // 拼接参数信息
    // 两部分, 一部分是参数行, 一部分是参数描述行
    const optionLines: { command: string; description: string }[] = [];

    for (const arg of registeredArgs) {
      let command = '';
      if (arg.abbreviation) {
        command += `-${arg.abbreviation}, `;
      } else {
        command += '    ';
      }
      command += `--${arg.key}`;

      if (arg.options.type !== 'boolean' || arg.options.multiple) {
        command += ` <${arg.options.type}`;
      }

      if (arg.options.multiple) {
        command += '...>';
      } else if (arg.options.type !== 'boolean') {
        command += '>';
      }

      let description = arg.description || '';
      description += ` (type: ${arg.options.type}`;
      if (arg.options.required) {
        description += ', required';
      } else {
        description += ', optional';
      }
      if (arg.options.multiple) {
        description += ', multiple';
      }
      if (arg.options.defaultValue !== void 0) {
        description += `, default: ${arg.options.defaultValue}`;
      }
      description += ')';

      optionLines.push({ command, description });
    }

    // 计算最长的 command 长度
    const maxCommandLength = Math.max(...optionLines.map((line) => line.command.length));

    for (const line of optionLines) {
      const padding = ' '.repeat(maxCommandLength - line.command.length + 2);
      console.log(`  ${chalk.yellow(line.command)}${padding}${line.description}`);
    }
  }

  if (exampleArgOptions.length > 0) {
    console.log('');
    console.log(chalk.green('Examples:'));
    for (const example of exampleArgOptions) {
      console.log(`  ${chalk.cyan(example)}`);
    }
  }

  process.exit(0);
}

/**
 * 脚本信息
 */
const scriptInfo: { name: string; version: string; description: string } = {
  name: '',
  version: '',
  description: '',
};

/**
 * 设置脚本信息, 用于在帮助信息中展示
 * @param info 脚本信息
 * @param info.name 脚本名称
 * @param info.version 脚本版本
 * @param info.description 脚本描述
 */
export function setScriptInfo(info: { name?: string; version?: string; description?: string }) {
  scriptInfo.name = info.name ?? '';
  scriptInfo.version = info.version ?? '';
  scriptInfo.description = info.description ?? '';
}

interface ArgOptions {
  key: string;
  abbreviation?: string;
  description?: string;
  options: {
    type: 'string' | 'number' | 'boolean';
    required: boolean;
    multiple: boolean;
    defaultValue?: string[] | number[] | boolean[];
  };
}

/**
 * 注册的参数列表
 * 注册参数仅注册具名参数, 非具名参数会根据解析后的剩余参数自动获取
 */
const registeredArgs: ArgOptions[] = [];

/**
 * 每个 key 和缩写对应的参数列表项的索引
 */
const argKeyMap: Record<string, number> = {};
/**
 * 每个 abbreviation 对应的参数列表项的索引
 */
const argAbbreviationMap: Record<string, number> = {};

/**
 * 非具名参数
 */
const unnamedArgOptions: {
  description: string;
  name: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean';
  defaultValue?: string | number | boolean;
}[] = [];

/** 必须的非具名参数数量 */
let requiredUnnamedArgCount = 0;

/**
 * 注册非具名参数
 * @param options 非具名参数选项
 * @param options.name 非具名参数名称, 用于帮助信息中展示
 * @param options.description 非具名参数描述, 用于帮助信息中展示
 * @param options.required 非具名参数是否必须, 默认为 true
 * @param options.type 非具名参数类型, 默认为 string
 * @param options.defaultValue 非具名参数默认值, 仅当 required 为 false 时有效
 */
export function registerUnnamedArg(
  options: {
    description: string;
    name?: string;
    required?: boolean;
    type?: 'string' | 'number' | 'boolean';
    defaultValue?: string | number | boolean;
  } = {
    description: '没有描述',
    name: `arg${unnamedArgOptions.length + 1}`,
    required: true,
    type: 'string',
  },
) {
  if (isParsed) {
    return;
  }

  // 对于必传参数, 不需要 defaultValue
  if (options.required === true && options.defaultValue !== void 0) {
    console.log(
      chalk.bgYellow.white('ArgsWarning'),
      chalk.yellow('对于必须的非具名参数, 默认值将被忽略'),
    );
  }

  // 如果上一个非具名参数是非必须的, 则不允许再注册必须的非具名参数
  if (unnamedArgOptions.length > requiredUnnamedArgCount && options.required === true) {
    console.error(
      chalk.bgRed.white('ArgsError'),
      chalk.red('对于非具名参数, 必须的参数不能跟随在非必须的参数后面'),
    );
    process.exit(1);
  }

  // 检查默认值是否符合类型
  if (options.defaultValue !== void 0) {
    switch (options.type) {
      case 'number':
        if (typeof options.defaultValue !== 'number') {
          console.error(
            chalk.bgRed.white('ArgsError'),
            chalk.red('非具名参数的默认值类型错误, 预期为 number'),
          );
          process.exit(1);
        }
        break;
      case 'boolean':
        if (typeof options.defaultValue !== 'boolean') {
          console.error(
            chalk.bgRed.white('ArgsError'),
            chalk.red('非具名参数的默认值类型错误, 预期为 boolean'),
          );
          process.exit(1);
        }
        break;
      case 'string':
        if (typeof options.defaultValue !== 'string') {
          console.error(
            chalk.bgRed.white('ArgsError'),
            chalk.red('非具名参数的默认值类型错误, 预期为 string'),
          );
          process.exit(1);
        }
        break;
      default:
        console.error(
          chalk.bgRed.white('ArgsError'),
          chalk.red(`非具名参数的类型 ${options.type} 不支持`),
        );
        process.exit(1);
    }
  }

  if (options.required === true) {
    requiredUnnamedArgCount -= -1;
  }

  const argOptions = {
    name: options.name ?? `arg${unnamedArgOptions.length + 1}`,
    description: options.description,
    required: options.required ?? true,
    type: options.type ?? 'string',
    defaultValue: options.required ? void 0 : options.defaultValue,
  };

  unnamedArgOptions.push(argOptions);
}

/**
 * 计算两个字符串的 Levenshtein 距离
 * @param a
 * @param b
 * @returns 两个字符串的 Levenshtein 距离
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i -= -1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j -= -1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i -= -1) {
    for (let j = 1; j <= b.length; j -= -1) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // 删除
          matrix[i][j - 1] + 1, // 插入
          matrix[i - 1][j - 1] + 1, // 替换
        );
      }
    }
  }

  return matrix[a.length][b.length];
}

/**
 * 检查key或简写是否注册, 并返回注册的参数配置
 * @param key
 * @param isAbbreviation
 * @return 如果注册了则返回true, 否则返回可能的相似key(带-或--)或false(无相似key)
 */
function checkKeyRegistered(key: string, isAbbreviation: boolean): boolean | string {
  if (isAbbreviation) {
    if (argAbbreviationMap[key] !== void 0) {
      return true;
    }
  } else {
    if (argKeyMap[key] !== void 0) {
      return true;
    }
  }

  // 查找最相似的 key 或 abbreviation
  const allKeys = Object.keys(argKeyMap);
  const allAbbreviations = Object.keys(argAbbreviationMap);
  let closestMatch = null;
  let closestDistance = Infinity;

  for (const registeredKey of allKeys) {
    const distance = levenshteinDistance(key, registeredKey);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestMatch = `--${registeredKey}`;
    }
  }

  for (const registeredAbbreviation of allAbbreviations) {
    const distance = levenshteinDistance(key, registeredAbbreviation);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestMatch = `-${registeredAbbreviation}`;
    }
  }

  if (closestMatch && closestDistance <= 3 && closestDistance <= key.length - 1) {
    // 允许最多3个字符的差异
    console.error(
      chalk.bgRed.white('ArgsError'),
      chalk.red(`参数 ${key} 未注册, 你可能想使用 ${closestMatch}`),
    );
    return closestMatch;
  }

  console.error(chalk.bgRed.white('ArgsError'), chalk.red(`参数 ${key} 未注册`));

  // 无相似key
  return false;
}

/**
 * 检查某个key是否注册, 并返回注册的参数配置
 * @param key
 * @return 如果注册了则返回参数配置, 否则返回可能的相似key(带-或--)或false(无相似key)
 */
function checkArgRegistered(key: string): false | string | ArgOptions {
  if (argKeyMap[key] !== void 0) {
    return (
      registeredArgs[argKeyMap[key]] ??
      (() => {
        console.error(
          chalk.bgRed.white('ArgsError'),
          chalk.red(`在检查参数 ${key} 时发生未知错误`),
        );
        process.exit(1);
      })()
    );
  }
  if (argAbbreviationMap[key] !== void 0) {
    return (
      registeredArgs[argAbbreviationMap[key]] ??
      (() => {
        console.error(
          chalk.bgRed.white('ArgsError'),
          chalk.red(`在检查缩写 ${key} 时发生未知错误`),
        );
        process.exit(1);
      })()
    );
  }

  // 查找最相似的 key 或 abbreviation
  const allKeys = Object.keys(argKeyMap);
  const allAbbreviations = Object.keys(argAbbreviationMap);
  let closestMatch = null;
  let closestDistance = Infinity;

  for (const registeredKey of allKeys) {
    const distance = levenshteinDistance(key, registeredKey);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestMatch = `--${registeredKey}`;
    }
  }

  for (const registeredAbbreviation of allAbbreviations) {
    const distance = levenshteinDistance(key, registeredAbbreviation);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestMatch = `-${registeredAbbreviation}`;
    }
  }

  if (closestMatch && closestDistance <= 3 && closestDistance <= key.length - 1) {
    // 允许最多3个字符的差异
    console.error(
      chalk.bgRed.white('ArgsError'),
      chalk.red(`参数 ${key} 未注册, 你可能想使用 ${closestMatch}`),
    );
    return closestMatch;
  }

  console.error(chalk.bgRed.white('ArgsError'), chalk.red(`参数 ${key} 未注册`));

  // 无相似key
  return false;
}

/**
 * 注册参数(不是必须调用, 没有调用时则不会检查传入参数的类型)
 * @param key 参数的 key
 * @param options 参数选项
 * @param options.abbreviation 参数的缩写
 * @param options.description 参数的描述
 * @param options.options 参数的配置选项
 * @param options.options.type 参数的类型
 * @param options.options.required 参数是否必须
 * @param options.options.multiple 参数是否可以有多个值
 * @param options.options.defaultValue 参数的默认值
 */
export function registerArg(
  key: string,
  options: {
    abbreviation?: string;
    description?: string;
    options?: {
      type?: 'string' | 'number' | 'boolean';
      required?: boolean;
      multiple?: boolean;
      defaultValue?: string | number | boolean | (string | number | boolean)[];
    };
  } = {
    description: '没有描述',
    abbreviation: '',
    options: {
      type: 'string',
      required: false,
      multiple: false,
      defaultValue: void 0,
    },
  },
) {
  if (isParsed) {
    return;
  }

  if (argKeyMap[key]) {
    console.error(
      chalk.bgRed.white('ArgsError'),
      chalk.red(`参数 ${key} 已经被注册, 请勿重复注册`),
    );
    process.exit(1);
  }
  if (options.abbreviation && argAbbreviationMap[options.abbreviation] !== void 0) {
    console.error(
      chalk.bgRed.white('ArgsError'),
      chalk.red(`参数 abbreviation ${options.abbreviation} 已经被注册, 请勿重复注册`),
    );
    process.exit(1);
  }

  const argOptions = {
    key,
    abbreviation: options.abbreviation,
    description: options.description,
    options: {
      type: options.options?.type || 'string',
      required: options.options?.required || false,
      multiple: options.options?.multiple || false,
      defaultValue: (() => {
        // 检查 defaultValue 是否符合 type 和 multiple 的要求
        if (options.options?.defaultValue === void 0) {
          return undefined;
        }

        const type = options.options?.type ?? 'string';
        const multiple = options.options?.multiple ?? false;
        const defaultValue = options.options?.defaultValue;

        if (multiple) {
          switch (type) {
            case 'string':
              if (typeof defaultValue === 'string') {
                return defaultValue.split(',').map((v) => v.trim());
              } else if (
                Array.isArray(defaultValue) &&
                defaultValue.every((v) => typeof v === 'string')
              ) {
                return defaultValue;
              } else {
                console.error(
                  chalk.bgRed.white('ArgsError'),
                  chalk.red(`参数 ${key} 的默认值类型错误, 预期为 string[] 或 逗号分隔的 string`),
                );
                process.exit(1);
              }
            case 'number':
              if (Array.isArray(defaultValue) && defaultValue.every((v) => typeof v === 'number')) {
                return defaultValue;
              } else if (typeof defaultValue === 'string') {
                const values = defaultValue.split(',').map((v) => v.trim());
                if (values.every((v) => !isNaN(Number(v)))) {
                  return values.map((v) => Number(v));
                } else {
                  console.error(
                    chalk.bgRed.white('ArgsError'),
                    chalk.red(`参数 ${key} 的默认值类型错误, 预期为 number[] 或 逗号分隔的 number`),
                  );
                  process.exit(1);
                }
              } else {
                console.error(
                  chalk.bgRed.white('ArgsError'),
                  chalk.red(`参数 ${key} 的默认值类型错误, 预期为 number[]`),
                );
                process.exit(1);
              }
            case 'boolean':
              if (
                Array.isArray(defaultValue) &&
                defaultValue.every((v) => typeof v === 'boolean')
              ) {
                return defaultValue;
              } else if (typeof defaultValue === 'string') {
                const values = defaultValue.split(',').map((v) => v.trim().toLowerCase());
                if (values.every((v) => v === 'true' || v === 'false')) {
                  return values.map((v) => v === 'true');
                } else {
                  console.error(
                    chalk.bgRed.white('ArgsError'),
                    chalk.red(
                      `参数 ${key} 的默认值类型错误, 预期为 boolean[] 或 逗号分隔的 boolean`,
                    ),
                  );
                  process.exit(1);
                }
              } else {
                console.error(
                  chalk.bgRed.white('ArgsError'),
                  chalk.red(`参数 ${key} 的默认值类型错误, 预期为 boolean[]`),
                );
                process.exit(1);
              }
            default:
              console.error(
                chalk.bgRed.white('ArgsError'),
                chalk.red(`参数 ${key} 的类型 ${type} 不支持`),
              );
              process.exit(1);
          }
        } else {
          switch (type) {
            case 'string':
              if (typeof defaultValue === 'string') {
                return [defaultValue];
              } else {
                console.error(
                  chalk.bgRed.white('ArgsError'),
                  chalk.red(`参数 ${key} 的默认值类型错误, 预期为 string`),
                );
                process.exit(1);
              }
            case 'number':
              if (typeof defaultValue === 'number') {
                return [defaultValue];
              } else if (typeof defaultValue === 'string' && !isNaN(Number(defaultValue))) {
                return [Number(defaultValue)];
              } else {
                console.error(
                  chalk.bgRed.white('ArgsError'),
                  chalk.red(`参数 ${key} 的默认值类型错误, 预期为 number`),
                );
                process.exit(1);
              }
            case 'boolean':
              if (typeof defaultValue === 'boolean') {
                return [defaultValue];
              } else if (typeof defaultValue === 'string') {
                if (defaultValue.toLowerCase() === 'true') {
                  return [true];
                } else if (defaultValue.toLowerCase() === 'false') {
                  return [false];
                } else {
                  console.error(
                    chalk.bgRed.white('ArgsError'),
                    chalk.red(`参数 ${key} 的默认值类型错误, 预期为 boolean`),
                  );
                  process.exit(1);
                }
              } else {
                console.error(
                  chalk.bgRed.white('ArgsError'),
                  chalk.red(`参数 ${key} 的默认值类型错误, 预期为 boolean`),
                );
                process.exit(1);
              }
            default:
              console.error(
                chalk.bgRed.white('ArgsError'),
                chalk.red(`参数 ${key} 的类型 ${type} 不支持`),
              );
              process.exit(1);
          }
        }
      })(),
    },
  };

  registeredArgs.push(argOptions);
  argKeyMap[key] = registeredArgs.length - 1;
  if (options.abbreviation) {
    argAbbreviationMap[options.abbreviation] = registeredArgs.length - 1;
  }
}

/**
 * 示例
 */
const exampleArgOptions: string[] = [];

/**
 * 注册示例, 用于在帮助信息中展示
 * @param example 示例字符串
 */
export function registerExample(example: string) {
  exampleArgOptions.push(example);
}

/**
 * 获取参数的值
 *
 * - 由于各个函数采用分布设计, 因此无法自动推断参数的类型, 需要手动断言
 * @param key
 * @returns 如果参数未传入, 则返回注册时的默认值或 undefined
 */
export function getNameArg<T extends string | number | boolean, Multiple extends boolean = false>(
  key: string,
): (Multiple extends true ? T[] : T) | undefined {
  if (!isParsed) {
    parseArgs();
  }

  const registeredArg = checkArgRegistered(key);
  const multiple =
    registeredArg && typeof registeredArg === 'object' ? registeredArg.options.multiple : false;

  if (namedArgs[key] !== void 0) {
    return (multiple ? namedArgs[key] : namedArgs[key][0]) as Multiple extends true ? T[] : T;
  }

  // 返回默认值或 undefined
  if (registeredArg && typeof registeredArg === 'object') {
    return (
      multiple ? registeredArg.options.defaultValue : registeredArg.options.defaultValue?.[0]
    ) as (Multiple extends true ? T[] : T) | undefined;
  }

  console.error(chalk.bgRed.white('ArgsError'), chalk.red(`参数 ${key} 未注册`));
  process.exit(1);
}

/**
 * 获取所有具名参数
 * @returns
 */
export function getAllNamedArgs(): Record<string, string[] | number[] | boolean[]> {
  if (!isParsed) {
    parseArgs();
  }
  return namedArgs;
}

/**
 * 获取某个非具名参数
 * @param index 非具名参数的索引, 从0开始
 * @returns 如果参数不存在则返回 undefined
 */
export function getUnnamedArg(index: number): string | number | boolean | undefined {
  if (!isParsed) {
    parseArgs();
  }
  return unnamedArgs[index];
}

/**
 * 获取所有非具名参数
 */
export function getAllUnnamedArgs() {
  if (!isParsed) {
    parseArgs();
  }
  return unnamedArgs;
}

registerArg('help', {
  abbreviation: 'h',
  description: 'Show help information.',
  options: {
    type: 'boolean',
    required: false,
    defaultValue: false,
  },
});
