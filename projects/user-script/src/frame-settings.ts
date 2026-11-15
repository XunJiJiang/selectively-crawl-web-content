import { z } from 'zod';
import { ConfigController } from '../../shared/store/config.ts';
import { CONFIG_CHANGED_EVENT } from '../../shared/userscript-config.ts';
import { snapshotSchema } from '../../shared/userscript-config-schema.ts';
import type { NotifyHandle } from '../../shared/types/notify.d.ts';
import { notify } from './utils/notify.ts';

const protocol = 'scwc-userscript-settings/v1';
const configSchema = snapshotSchema.shape.data.shape.config;
/** 所有脚本配置使用同一个补丁通道；调用方决定哪些修改需要询问同步。 */
const patchSchema = z
  .object({
    showInChildFrames: z.boolean().optional(),
    config: z
      .object({
        api: configSchema.shape.api.partial().optional(),
        plugin: configSchema.shape.plugin.partial().optional(),
        notify: configSchema.shape.notify.partial().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ScriptSettingsPatch = z.infer<typeof patchSchema>;
type SyncMessage = {
  protocol: typeof protocol;
  type: 'sync';
  id: string;
  patch: ScriptSettingsPatch;
};

/** 每页只与直接父子窗口通信，隐藏页面也保留设置桥。 */
export class FrameSettingsController {
  private page: Window;
  private storage: Storage;
  private visibilityChanged: (visible: boolean) => void;
  private running = false;
  private allowed = false;
  private showChildren = false;
  private storageKey = '';
  private retry?: ReturnType<typeof setInterval>;
  private prompt?: NotifyHandle;
  private pendingSync?: SyncMessage;
  private receivedSync = new Set<string>();

  constructor(
    visibilityChanged: (visible: boolean) => void,
    page: Window = window,
    storage = localStorage,
  ) {
    this.visibilityChanged = visibilityChanged;
    this.page = page;
    this.storage = storage;
    this.storageKey = `scwc.userscript.frame-settings.v1:${this.page.location.origin}`;
  }
  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.page.addEventListener('message', this.message);
    this.page.addEventListener('storage', this.storageChanged);
    this.loadSettings(true);
    if (this.page.parent === this.page) {
      this.setAllowed(true);
    } else {
      this.setAllowed(false);
      // 父页脚本可能晚于子页初始化；在收到本层策略前保持隐藏。
      this.retry = setInterval(this.requestParent, 1000);
      this.requestParent();
    }
  }
  stop() {
    this.running = false;
    clearInterval(this.retry);
    this.page.removeEventListener('message', this.message);
    this.page.removeEventListener('storage', this.storageChanged);
    this.prompt?.close();
  }
  private loadSettings(migrateLegacy = false) {
    try {
      let saved = this.storage.getItem(this.storageKey);
      if (saved === null && migrateLegacy) {
        const url = new URL(this.page.location.href);
        const legacy = this.storage.getItem(`${this.storageKey}${url.pathname}`);
        if (legacy === 'true' || legacy === 'false') {
          saved = legacy;
          this.storage.setItem(this.storageKey, saved);
        }
      }
      this.showChildren = saved === 'true';
    } catch {
      this.showChildren = false;
    }
    this.pendingSync = undefined;
    this.prompt?.close();
    this.prompt = undefined;
    this.refreshControl();
    this.publishVisibility();
  }
  private storageChanged = (event: StorageEvent) => {
    if (event.key === this.storageKey || event.key === null) {
      // 同源其他页面的修改只更新本站策略；询问只由直接操作的页面发起。
      this.loadSettings();
    }
  };
  private refreshControl() {
    ConfigController.setAdditionalControls([
      {
        type: 'checkbox',
        label: '允许直接子 iframe 显示脚本',
        channel: 'script-show-in-child-frames',
        options: { defaultValue: this.showChildren },
        trigger: (value) => this.setShowInChildFrames(value === true),
      },
    ]);
  }
  setShowInChildFrames(value: boolean) {
    if (value === this.showChildren) {
      return;
    }
    this.pendingSync = undefined;
    this.applyPatch({ showInChildFrames: value });
    this.requestDescendantSync({ showInChildFrames: value }, 'iframe 显示设置');
  }
  /** 可复用到任意脚本配置补丁，接收同步不再递归弹出确认通知。 */
  requestDescendantSync(input: ScriptSettingsPatch, label: string) {
    const patch = patchSchema.parse(input);
    this.prompt?.close();
    if (!this.page.frames.length) {
      return;
    }
    const prompt = (this.prompt = notify({
      title: '是否同步子页面设置？',
      description: `${label}已修改，本站同源页面共用此设置。是否将相同设置同步到更深层的全部子页面？`,
      placement: ConfigController.config.notify.placement,
      duration: 0,
      actions: [
        {
          label: '同步全部后代',
          onClick: () => {
            if (this.prompt !== prompt) {
              return;
            }
            this.synchronizeSettings(patch);
            prompt?.close();
            this.prompt = undefined;
          },
        },
        {
          label: '仅本站',
          onClick: () => {
            prompt?.close();
            if (this.prompt === prompt) {
              this.prompt = undefined;
            }
          },
        },
      ],
    }));
  }
  synchronizeSettings(input: ScriptSettingsPatch) {
    const patch = patchSchema.parse(input);
    this.relaySync({ protocol, type: 'sync', id: crypto.randomUUID(), patch });
  }
  private applyPatch(patch: ScriptSettingsPatch) {
    if (patch.config) {
      const current = ConfigController.config;
      const config = {
        api: { ...current.api, ...patch.config.api },
        plugin: { ...current.plugin, ...patch.config.plugin },
        notify: { ...current.notify, ...patch.config.notify },
      };
      ConfigController.applyConfig(config);
      this.page.dispatchEvent(new CustomEvent(CONFIG_CHANGED_EVENT, { detail: config }));
    }
    if (patch.showInChildFrames !== undefined) {
      this.showChildren = patch.showInChildFrames;
      try {
        this.storage.setItem(this.storageKey, JSON.stringify(this.showChildren));
      } catch {
        // 禁用存储时，当前文档内的父子策略仍可用。
      }
      this.refreshControl();
      this.publishVisibility();
    }
  }
  private setAllowed(value: boolean) {
    this.allowed = value;
    this.visibilityChanged(value);
  }
  private send(target: Window, message: object) {
    try {
      // 只给已验证的父子 WindowProxy 发消息，支持跨域和 opaque origin iframe。
      target.postMessage(message, '*');
    } catch {
      // 子窗口可能已导航或销毁。
    }
  }
  private eachChild(callback: (child: Window) => void) {
    for (let i = 0; i < this.page.frames.length; i++) {
      callback(this.page.frames[i]);
    }
  }
  private publishVisibility() {
    this.eachChild((child) =>
      this.send(child, { protocol, type: 'visibility', visible: this.showChildren }),
    );
  }
  private requestParent = () => {
    this.send(this.page.parent, { protocol, type: 'request' });
  };
  private relaySync(message: SyncMessage) {
    this.pendingSync = message;
    this.eachChild((child) => this.send(child, message));
  }
  private message = (event: MessageEvent) => {
    const message = event.data;
    if (!message || message.protocol !== protocol || !event.source) {
      return;
    }
    if (event.source === this.page.parent && this.page.parent !== this.page) {
      if (message.type === 'visibility' && typeof message.visible === 'boolean') {
        clearInterval(this.retry);
        if (message.visible !== this.allowed) {
          this.setAllowed(message.visible);
        }
      } else if (
        message.type === 'sync' &&
        typeof message.id === 'string' &&
        message.id.length <= 128
      ) {
        const parsed = patchSchema.safeParse(message.patch);
        if (!parsed.success || this.receivedSync.has(message.id)) {
          return;
        }
        this.receivedSync.add(message.id);
        if (this.receivedSync.size > 100) {
          const first = this.receivedSync.values().next().value;
          if (first !== undefined) {
            this.receivedSync.delete(first);
          }
        }
        this.prompt?.close();
        this.prompt = undefined;
        this.applyPatch(parsed.data);
        this.relaySync({ protocol, type: 'sync', id: message.id, patch: parsed.data });
      }
      return;
    }
    if (message.type !== 'request') {
      return;
    }
    this.eachChild((child) => {
      if (event.source !== child) {
        return;
      }
      this.send(child, { protocol, type: 'visibility', visible: this.showChildren });
      if (this.pendingSync) {
        this.send(child, this.pendingSync);
      }
    });
  };
}
