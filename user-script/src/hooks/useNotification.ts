import { notification } from 'antd';

export function useNotification() {
  const [api, contextHolder] = notification.useNotification();
  return {
    api,
    contextHolder,
    info: notification.info,
    success: notification.success,
    error: notification.error,
    warn: notification.warning,
  };
}
