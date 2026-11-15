import { browser, type Reply } from './browser.ts';
import { notify } from '../../shared/components/notify.ts';
import type { NotificationAction } from '../../shared/workbench-feedback.ts';
import type { NotifyHandle } from '../../shared/types/notify.d.ts';
import {
  COEXISTENCE_PROTOCOL,
  readScriptPresence,
  type CoexistenceInfo,
} from '../../shared/client-coexistence.ts';

const installed = '__scwcCoexistenceV1';
const scope = globalThis as typeof globalThis & { [installed]?: boolean };
if (!scope[installed] && window.parent === window) {
  scope[installed] = true;
  let shown = false;
  let active = true;
  let notice: NotifyHandle | undefined;
  const receive = async (event: MessageEvent) => {
    if (
      shown ||
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.protocol !== COEXISTENCE_PROTOCOL ||
      event.data.type !== 'script'
    ) {
      return;
    }
    const script = readScriptPresence(event.data.script);
    if (!script) {
      return;
    }
    shown = true;
    try {
      const reply = await browser.runtime.sendMessage<Reply<CoexistenceInfo>>({
        type: 'coexistence.info',
        script,
      });
      if (!active || !reply?.ok || !reply.data || reply.data.suppressed) {
        return;
      }
      const info = reply.data;
      const actions: NotificationAction[] = [];
      const open = async (target: 'script' | 'extension') => {
        try {
          const result = await browser.runtime.sendMessage<Reply<void>>({
            type: 'coexistence.open',
            script,
            target,
          });
          if (!result?.ok) {
            throw new Error(result?.error || '无法打开管理页');
          }
        } catch {
          notice?.update({
            description: `${description}\n无法直接打开管理页，请从油猴或浏览器菜单手动打开。`,
          });
        }
      };
      if (info.scriptManager) {
        actions.push({ label: '去关闭油猴脚本', onClick: () => open('script') });
      }
      if (info.extensionManager) {
        actions.push({ label: '去关闭浏览器扩展', onClick: () => open('extension') });
      }
      actions.push({
        label: '不再提示',
        onClick: async () => {
          try {
            const result = await browser.runtime.sendMessage<Reply<void>>({
              type: 'coexistence.dismiss',
              script,
            });
            if (!result?.ok) {
              throw new Error(result?.error || '无法保存提醒设置');
            }
            notice?.close();
          } catch {
            notice?.update({ description: `${description}\n保存“不再提示”失败，请重试。` });
          }
        },
      });
      const description = [
        '建议使用浏览器扩展并关闭油猴脚本，避免重复显示和操作；如需保留脚本，也可以关闭浏览器扩展。',
        '按钮仅打开管理页，请在管理页中关闭对应脚本或扩展；关闭后刷新已打开的网页。',
        info.instructions,
      ]
        .filter(Boolean)
        .join('\n');
      notice = notify({
        title: `检测到扩展 v${info.extensionVersion} 和油猴脚本 v${script.version}`,
        description,
        type: 'warn',
        duration: 0,
        actions,
        useCore: false,
      });
    } catch {
      /* Extension update/unload must not affect the user's page. */
    }
  };
  window.addEventListener('message', receive);
  window.addEventListener(
    'pagehide',
    () => {
      active = false;
      window.removeEventListener('message', receive);
      notice?.close();
    },
    { once: true },
  );
  window.postMessage({ protocol: COEXISTENCE_PROTOCOL, type: 'probe' }, location.origin);
}
