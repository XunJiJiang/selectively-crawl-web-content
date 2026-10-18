import type { Keybinding } from './types.ts';
export interface Command {
  id: string;
  label: string;
  category: string;
  description: string;
  keys: string[];
  context: string;
}
const command = (
  id: string,
  label: string,
  category: string,
  keys: string[] = [],
  description = '',
  context = 'workbench && !inputFocus',
): Command => ({ id, label, category, keys, description: description || label, context });
export const commands: Command[] = [
  command('quickOpen', '快速访问', '页面', ['Mod+Shift+P', 'F1']),
  command('openUrl', '打开插件 URL', '页面', ['Alt+L']),
  command('closeTab', '关闭当前标签', '页面', ['Alt+W']),
  command('closeOthers', '关闭其他标签', '页面'),
  command('closeAll', '关闭所有未固定标签', '页面'),
  command('restoreClosed', '恢复最近关闭的标签', '页面', ['Alt+Shift+T']),
  command('nextTab', '下一个标签', '页面', ['Alt+J']),
  command('previousTab', '上一个标签', '页面', ['Alt+K']),
  command('refresh', '刷新当前插件页面', '页面', ['Alt+R']),
  command('stopLoading', '停止页面加载', '页面'),
  command('back', '后退', '页面', ['Alt+ArrowLeft']),
  command('forward', '前进', '页面', ['Alt+ArrowRight']),
  command('copyUrl', '复制当前 URL', '页面'),
  command('openExternal', '在浏览器打开', '页面'),
  command('pin', '固定 / 取消固定标签', '页面'),
  command('rename', '重命名标签', '页面'),
  command('bookmark', '收藏当前页面', '页面'),
  command('hibernate', '休眠当前页面', '页面'),
  command('keepAlive', '保持页面运行', '页面'),
  command('sidebar', '切换主侧栏', '视图', ['Mod+B']),
  command('auxiliary', '切换辅助侧栏', '视图'),
  command('panel', '切换底部面板', '视图', ['Ctrl+`']),
  command('focusGroup', '专注当前组', '视图'),
  command('fullscreen', '切换全屏', '视图'),
  command('search', '打开搜索', '视图', ['Mod+Shift+F']),
  command('pages', '打开页面视图', '视图'),
  command('bookmarks', '打开收藏', '视图'),
  command('history', '打开关闭历史', '视图'),
  command('plugins', '打开插件管理', '插件'),
  command('splitRight', '向右拆分', '布局'),
  command('splitDown', '向下拆分', '布局'),
  command('equalize', '均分所有分组', '布局'),
  command('merge', '合并所有分组', '布局'),
  command('swapSidebars', '主侧栏左右切换', '布局'),
  command('resetLayout', '恢复默认布局', '布局'),
  command('saveLayout', '保存布局预设', '布局'),
  command('applyLayout', '应用布局预设', '布局'),
  command('plugin.enable', '启用指定插件', '插件'),
  command('plugin.reload', '重启指定插件后端', '插件'),
  command('plugin.disable', '禁用指定插件', '插件'),
  command('plugin.stop', '临时停止指定插件', '插件'),
  command('plugin.build', '构建指定插件页面', '插件'),
  command('rescan', '重新扫描插件目录', '插件'),
  command('jobs', '查看构建任务', '插件'),
  command('newTerminal', '新建命令终端', '工具'),
  command('output', '打开输出', '工具'),
  command('notifications', '通知中心', '工具'),
  command('export', '导出工作区草稿', '工具'),
  command('settings', '打开设置', '帮助', ['Mod+,']),
  command('keybindings', '打开快捷键设置', '帮助'),
  command('connection', '连接设置', '帮助'),
  command('about', '关于工作台与页面能力', '帮助'),
  command(
    'terminal.submit',
    '提交命令 / 输入',
    '终端',
    ['Enter'],
    '提交命令，Shift+Enter 换行',
    'terminal',
  ),
  command('terminal.complete', '打开命令补全', '终端', ['Tab'], '仅补全，不执行命令', 'terminal'),
  command(
    'terminal.cancel',
    '协作取消执行',
    '终端',
    ['Ctrl+C'],
    '有选区时复制；Cmd+C 保持复制行为',
    'terminal',
  ),
  command('terminal.clear', '清空当前终端输出', '终端'),
  command('terminal.history', '清空当前终端历史', '终端'),
];
export const platform = () =>
  /Mac|iPhone|iPad/.test(navigator.platform)
    ? 'mac'
    : /Win/.test(navigator.platform)
      ? 'windows'
      : 'linux';
export function canonicalKey(key: string) {
  return key.replace(/Mod/g, platform() === 'mac' ? 'Meta' : 'Ctrl');
}
export function effectiveKeys(command: Command, overrides: Keybinding[] = []) {
  const binding = [...overrides]
    .reverse()
    .find(
      (b) =>
        b.commandId === command.id &&
        (b.platform === platform() || b.platform === 'all') &&
        b.context === command.context,
    );
  return binding ? (binding.keys ?? []) : command.keys.map(canonicalKey);
}
export function shortcut(id: string, overrides: Keybinding[] = []) {
  const c = commands.find((c) => c.id === id);
  return c
    ? (effectiveKeys(c, overrides)[0]
        ?.replace(/Meta/g, '⌘')
        .replace(/Ctrl/g, '⌃')
        .replace(/Alt/g, '⌥')
        .replace(/Shift/g, '⇧')
        .replace(/\+/g, ' ') ?? '')
    : '';
}
export function eventKey(event: KeyboardEvent) {
  const key =
    event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
    return '';
  }
  return [
    event.metaKey ? 'Meta' : '',
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    key,
  ]
    .filter(Boolean)
    .join('+');
}
export function matchesKey(binding: string, event: KeyboardEvent) {
  return canonicalKey(binding).toLowerCase() === eventKey(event).toLowerCase();
}
export function editableTarget(event: KeyboardEvent) {
  return event
    .composedPath()
    .some(
      (t) =>
        t instanceof HTMLElement &&
        (t.matches('input,textarea,select,[contenteditable=true]') ||
          t.classList.contains('cm-content')),
    );
}
export function conflicts(command: Command, keys: string[], overrides: Keybinding[]) {
  return commands.filter(
    (c) =>
      c.id !== command.id &&
      (c.context === command.context || c.context === 'workbench') &&
      effectiveKeys(c, overrides).some((k) =>
        keys.some((next) => canonicalKey(next).toLowerCase() === k.toLowerCase()),
      ),
  );
}
