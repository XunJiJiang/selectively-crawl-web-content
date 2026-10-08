import type { TerminalPlugin } from '../types.ts';

export default {
  apiVersion: 1,
  onLoad({ registerCommand }) {
    registerCommand({
      name: 'ask',
      description: '演示执行中等待用户输入及取消错误元组',
      async execute(context) {
        const [error, value] = await context.next('请输入数量（Ctrl+C 取消）', Number);
        if (error) {
          context.logger.warn(error.code, error.message);
          return;
        }
        context.logger.info('输入数量：', value);
      },
    });
    registerCommand({
      name: 'later',
      description: '演示函数返回后仍在执行的后台任务',
      execute(context) {
        const handle = context.tasks.begin('延迟输出');
        const timer = setTimeout(() => {
          context.logger.info('任务完成', {
            windowId: context.windowId,
            executionId: context.executionId,
          });
          handle.end();
        }, 1000);
        context.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            context.logger.info('任务取消');
            handle.end();
          },
          { once: true },
        );
      },
    });
  },
} satisfies TerminalPlugin;
