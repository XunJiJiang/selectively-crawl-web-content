export const globalCommands = [
  { name: 'cancel', usage: 'cancel <tab id>', description: '取消任务' },
  { name: 'clear', usage: 'clear <output|history|all>', description: '清除当前标签输出或历史' },
  { name: 'close', usage: 'close [tab id]', description: '关闭指定标签', aliases: ['c'] },
  { name: 'help', usage: 'help', description: '查看命令和快捷键' },
  { name: 'new', usage: 'new', description: '新建命令标签' },
  { name: 'q', usage: 'q', description: '退出终端' },
  { name: 'rename', usage: 'rename [new title] <tab id>', description: '重命名命令标签' },
  { name: 'restart', usage: 'restart', description: '重启核心', aliases: ['r'] },
  { name: 'run', usage: 'run [tab id] [command]', description: '执行或替换标签任务' },
  { name: 'switch', usage: 'switch [tab id]', description: '切换标签', aliases: ['s'] },
  { name: 'transparent-bg', usage: 'transparent-bg [true|false]', description: '设置输出背景透明' },
  { name: 'w', usage: 'w', description: '关闭当前命令标签' },
];

export const reservedCommands = [
  'exit',
  ...globalCommands.flatMap((command) => [command.name, ...(command.aliases ?? [])]),
];
