import { notification } from 'antd';

/**
 * 没有自定义关闭延迟则修改为 5s
 */
function customNotify(args: Parameters<typeof notification.info>): Parameters<typeof notification.info> {
  if (args.length !== 1) {
    return args;
  }
  const firstArg = args[0];
  if (typeof firstArg === 'object' && !('duration' in firstArg)) {
    return [
      {
        ...firstArg,
        duration: 5,
      },
      ...args.slice(1),
    ] as Parameters<typeof notification.info>;
  }
  return args;
}

export function useNotification(): {
  api: ReturnType<typeof notification.useNotification>[0];
  contextHolder: ReturnType<typeof notification.useNotification>[1];
  info: typeof notification.info;
  success: typeof notification.success;
  error: typeof notification.error;
  warn: typeof notification.warning;
} {
  const [api, contextHolder] = notification.useNotification();
  return {
    api,
    contextHolder,
    info: (...args) => notification.info(...customNotify(args)),
    success: (...args) => notification.success(...customNotify(args)),
    error: (...args) => notification.error(...customNotify(args)),
    warn: (...args) => notification.warning(...customNotify(args)),
  };
}
