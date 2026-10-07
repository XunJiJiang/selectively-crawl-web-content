import type { TerminalPlugin } from '../types.ts';

export default {
  apiVersion: 1,
  onLoad({ registerCommand }) {
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
