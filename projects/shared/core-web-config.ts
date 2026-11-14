/** 核心 Web 允许插件按需监听的配置；新增配置必须在此显式声明。 */
export interface CoreWebConfigValues {
  /** 当前核心 Web 的样式选择及实际生效的样式。 */
  theme: CoreWebTheme;
}

export type CoreWebConfigChannel = keyof CoreWebConfigValues;
/** 保留已知样式的补全，同时允许未来新增样式标识。 */
export type CoreWebThemeMode = 'dark-2026' | 'light-2026' | (string & {});
export const CORE_WEB_THEME_TOKENS = [
  '--surface-0',
  '--surface-1',
  '--text-primary',
  '--text-secondary',
  '--border-default',
  '--accent-primary',
  '--font-sans',
] as const;
export type CoreWebThemeToken = (typeof CORE_WEB_THEME_TOKENS)[number];
export interface CoreWebTheme {
  /** 设置中选择的样式；system 表示跟随系统。 */
  readonly preference: 'system' | CoreWebThemeMode;
  /** 实际生效的样式；跟随系统时已解析为深色或浅色。 */
  readonly mode: CoreWebThemeMode;
  /** 核心允许公开的语义变量。是否应用由插件决定。 */
  readonly tokens: Readonly<Record<CoreWebThemeToken, string>>;
}
export interface CoreWebConfig {
  /**
   * 按通道订阅。连接后首次交付当前值，随后交付变化；返回注销函数。
   * 可在 ready 前注册。仅工作台内可用，不修改插件的 DOM 或样式。
   */
  subscribe<C extends CoreWebConfigChannel>(
    channel: C,
    listener: (value: CoreWebConfigValues[C]) => void,
  ): () => void;
}
export type CoreWebConfigMessage = {
  [C in CoreWebConfigChannel]: {
    channel: C;
    revision: number;
    value: CoreWebConfigValues[C];
  };
}[CoreWebConfigChannel];

export function isCoreWebConfigChannel(value: unknown): value is CoreWebConfigChannel {
  return value === 'theme';
}

/** 验证跨文档数据，并复制、冻结后交付，避免监听器间互相修改快照。 */
export function readCoreWebConfigMessage(input: unknown): CoreWebConfigMessage | undefined {
  if (!input || typeof input !== 'object') {
    return;
  }
  const message = input as CoreWebConfigMessage;
  if (
    !isCoreWebConfigChannel(message.channel) ||
    !Number.isSafeInteger(message.revision) ||
    message.revision < 0
  ) {
    return;
  }
  const value = message.value;
  const identifier = (item: unknown) =>
    typeof item === 'string' && item.length > 0 && item.length <= 128;
  if (
    !value ||
    !identifier(value.preference) ||
    !identifier(value.mode) ||
    !value.tokens ||
    typeof value.tokens !== 'object' ||
    !CORE_WEB_THEME_TOKENS.every(
      (key) => typeof value.tokens[key] === 'string' && value.tokens[key].length <= 4096,
    )
  ) {
    return;
  }
  const tokens = Object.freeze(
    Object.fromEntries(CORE_WEB_THEME_TOKENS.map((key) => [key, value.tokens[key]])),
  ) as CoreWebTheme['tokens'];
  return Object.freeze({
    channel: message.channel,
    revision: message.revision,
    value: Object.freeze({ preference: value.preference, mode: value.mode, tokens }),
  });
}
