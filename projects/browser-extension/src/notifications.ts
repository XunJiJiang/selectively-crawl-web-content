import { NotifyController } from '../../shared/notify-controller.ts';
import { LitElement, html, css, unsafeCSS, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { browser } from './browser.ts';
import '../../web/src/components/icon.ts';
import '../../web/src/components/scroll-container.ts';
import type { WorkbenchScrollContainer } from '../../web/src/components/scroll-container.ts';
import type { ScrollState } from '../../shared/components/scroll-container/types.ts';
import type { VersionNotice } from '../../shared/client-version.ts';
import { scheduleFrame } from '../../shared/utils/frame.ts';
import {
  notificationStorageKey,
  readNotifications,
  type ExtensionNotification,
  type NotificationType,
} from './notification-model.ts';
import { layoutNotificationStack, stackContentHeight, stackWindow } from './notification-stack.ts';
import styles from './notifications.css?raw';

export { notificationStorageKey, type NotificationType } from './notification-model.ts';
const lifetime = 5000;
@customElement('scwc-extension-notifications')
export class ExtensionNotifications extends LitElement {
  static styles = css`
    ${unsafeCSS(styles)}
  `;
  @property({ type: Boolean, attribute: 'history-open', reflect: true }) accessor historyOpen =
    false;
  @state() private accessor records: ExtensionNotification[] = [];
  @state() private accessor expanded = false;
  @state() private accessor above = 0;
  @state() private accessor below = 0;
  @state() private accessor filter: 'all' | 'unread' | 'read' = 'all';
  suppressVersion: (notice: VersionNotice) => Promise<unknown> = async () => undefined;
  private timers = new NotifyController((id) => {
    this.records = this.records.map((entry) =>
      entry.id === id ? { ...entry, visible: false } : entry,
    );
  });
  private ready = this.load();
  private writes: Promise<unknown> = Promise.resolve();
  private persisted = new Map<string, string>();
  private pendingMutations = 0;
  private observer?: ResizeObserver;
  private frame?: () => void;
  private animationFrame?: () => void;
  private expansion = 0;
  private followHistory = true;
  private followToasts = true;
  private pointerInside = false;
  private heights: number[] = [];
  private observedCards = new Set<Element>();
  // 一次未读筛选保留这批条目，避免刚读完的行消失后把后续条目自动推进视口并全部读掉。
  private unreadCohort = new Set<string>();

  connectedCallback() {
    super.connectedCallback();
    this.timers.connect();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.layout());
      this.observer.observe(this);
      if (this.parentElement) {
        this.observer.observe(this.parentElement);
      }
    }
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.timers.suspend();
    this.observer?.disconnect();
    this.frame?.();
    this.frame = undefined;
    this.animationFrame?.();
    this.animationFrame = undefined;
  }
  private async load() {
    try {
      const saved: unknown = (await browser.storage?.local.get(notificationStorageKey))?.[
        notificationStorageKey
      ];
      // 弹窗重开只恢复历史，不重放横幅；旧历史没有 read 字段时视为未读。
      this.records = [...readNotifications(saved), ...this.records].sort(
        (a, b) => a.createdAt - b.createdAt,
      );
      this.persisted = new Map(
        readNotifications(saved).map((record) => [record.id, JSON.stringify(record)]),
      );
      this.captureUnread();
    } catch {
      // 存储不可用时，当前弹窗仍可显示和查看通知。
    }
  }
  private persist() {
    this.pendingMutations++;
    this.writes = this.writes
      .then(async () => {
        await this.ready;
        const records = this.records.map((entry) => ({ ...entry, visible: false }));
        const next = new Map(records.map((record) => [record.id, JSON.stringify(record)]));
        if (browser.runtime?.sendMessage) {
          const reply = await browser.runtime.sendMessage<{ ok: boolean; error?: string }>({
            type: 'notifications.save',
            upsert: records.filter(
              (record) => this.persisted.get(record.id) !== next.get(record.id),
            ),
            remove: [...this.persisted.keys()].filter((id) => !next.has(id)),
          });
          if (!reply?.ok) {
            throw new Error(reply?.error ?? '通知保存失败');
          }
        } else {
          await browser.storage?.local.set({ [notificationStorageKey]: records });
        }
        this.persisted = next;
      })
      .catch(() => undefined)
      .finally(() => {
        this.pendingMutations--;
      });
  }
  /** Background has already persisted this record; popup rendering never duplicates the write. */
  async receive(
    record: ExtensionNotification,
    options: { duration?: number; scope?: string } = {},
  ) {
    await this.ready;
    if (this.records.some((entry) => entry.id === record.id)) {
      return;
    }
    this.records = [...this.records, { ...record, visible: options.scope !== 'external' }];
    this.persisted.set(record.id, JSON.stringify({ ...record, visible: false }));
    this.unreadCohort.add(record.id);
    if (options.scope !== 'external') {
      this.timers.set(record.id, options.duration ?? lifetime);
    }
    if (!this.isConnected) {
      this.timers.suspend();
    }
    this.followToasts = true;
    this.followHistory = true;
  }
  async refreshHistory() {
    await this.writes;
    const saved = readNotifications(
      (await browser.storage.local.get(notificationStorageKey))[notificationStorageKey],
    );
    if (this.pendingMutations) {
      return;
    }
    const visible = new Map(
      this.records.filter((record) => record.visible).map((record) => [record.id, record]),
    );
    this.records = saved.map((record) => visible.get(record.id) ?? record);
    this.persisted = new Map(saved.map((record) => [record.id, JSON.stringify(record)]));
    this.captureUnread();
  }
  add(
    message: string,
    type: NotificationType = 'info',
    versionNotice?: VersionNotice,
    options: { duration?: number } = {},
  ) {
    if (!message) {
      return;
    }
    if (!this.active.length) {
      this.expanded = false;
    }
    this.followToasts = true;
    this.followHistory = true;
    const record: ExtensionNotification = {
      id: crypto.randomUUID(),
      message,
      type,
      createdAt: Date.now(),
      visible: true,
      read: false,
      versionNotice,
    };
    this.records = [...this.records, record];
    this.unreadCohort.add(record.id);
    this.timers.set(record.id, options.duration ?? lifetime);
    if (!this.isConnected) {
      this.timers.suspend();
    }
    this.persist();
    return record.id;
  }
  private pause(id: string, reason: 'pointer' | 'focus') {
    this.timers.pause(id, reason);
  }
  private resume(id: string, reason: 'pointer' | 'focus') {
    this.timers.resume(id, reason);
  }
  private dismiss(id: string) {
    this.timers.remove(id);
    this.records = this.records.filter((entry) => entry.id !== id);
    this.persist();
  }
  private async suppress(record: ExtensionNotification) {
    if (!record.versionNotice) {
      return;
    }
    try {
      await this.suppressVersion(record.versionNotice);
      this.dismiss(record.id);
    } catch (error) {
      this.add(error instanceof Error ? error.message : String(error), 'error');
    }
  }
  private get active() {
    return this.records.filter((entry) => entry.visible);
  }
  protected updated(changed: PropertyValues) {
    if (changed.has('historyOpen')) {
      this.followHistory = true;
      this.expanded = false;
      this.pointerInside = false;
      if (this.historyOpen) {
        this.captureUnread();
      }
      for (const id of this.timers.ids) {
        this.resume(id, 'pointer');
        this.resume(id, 'focus');
      }
    }
    if (changed.has('expanded') || changed.has('historyOpen')) {
      this.animateExpansion();
    }
    this.layout();
  }
  private animateExpansion() {
    this.animationFrame?.();
    this.animationFrame = undefined;
    const target = this.expanded ? 1 : 0;
    if (
      !this.isConnected ||
      this.historyOpen ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      this.expansion = target;
      return;
    }
    const from = this.expansion;
    if (from === target) {
      return;
    }
    const startedAt = performance.now();
    const duration = 180 * Math.abs(target - from);
    const step = () => {
      this.animationFrame = undefined;
      const progress = Math.min(1, Math.max(0, (performance.now() - startedAt) / duration));
      this.expansion = from + (target - from) * (1 - (1 - progress) ** 3);
      const driver = this.shadowRoot?.querySelector<WorkbenchScrollContainer>('.toast-scroll');
      if (driver) {
        // 动画只改变展开区域；滚动始终读取当前坐标，不重新插值或追赶旧目标。
        this.placeCards(driver.scrollState.scrollTop);
      }
      if (progress < 1) {
        this.animationFrame = scheduleFrame(step);
      }
    };
    this.animationFrame = scheduleFrame(step);
  }
  private layout() {
    this.frame?.();
    this.frame = scheduleFrame(() => {
      this.frame = undefined;
      void this.measure();
    });
  }
  private async measure() {
    const history = this.shadowRoot?.querySelector<WorkbenchScrollContainer>('.history');
    if (history) {
      await history.updateComplete;
      if (!this.isConnected || !this.historyOpen) {
        return;
      }
      history.refresh();
      if (this.followHistory) {
        history.scrollTo({ top: history.scrollState.maxScrollTop, behavior: 'instant' });
      }
      this.markVisibleRead();
      return;
    }
    const driver = this.shadowRoot?.querySelector<WorkbenchScrollContainer>('.toast-scroll');
    if (!driver) {
      return;
    }
    const cards = [...(this.shadowRoot?.querySelectorAll<HTMLElement>('.toast') ?? [])];
    for (const old of this.observedCards) {
      if (!cards.includes(old as HTMLElement)) {
        this.observer?.unobserve(old);
      }
    }
    for (const card of cards) {
      if (!this.observedCards.has(card)) {
        this.observer?.observe(card);
      }
    }
    this.observedCards = new Set(cards);
    this.heights = cards.map((card) => card.offsetHeight || stackWindow.collapsed);
    const height = stackContentHeight(this.heights);
    if (driver.metrics?.scrollHeight !== height) {
      driver.metrics = { scrollHeight: height };
    }
    await driver.updateComplete;
    if (!this.isConnected || this.historyOpen) {
      return;
    }
    driver.refresh();
    if (this.followToasts) {
      driver.scrollTo({ top: driver.scrollState.maxScrollTop, behavior: 'instant' });
      this.followToasts = false;
    }
    this.placeCards(driver.scrollState.scrollTop);
  }
  private placeCards(scrollTop: number) {
    const cards = [...(this.shadowRoot?.querySelectorAll<HTMLElement>('.toast') ?? [])];
    const geometry = layoutNotificationStack(
      this.heights,
      scrollTop,
      this.expanded,
      this.clientHeight || 468,
      this.expansion,
    );
    this.above = geometry.filter((item) => item.edge === 'above').length;
    this.below = geometry.filter((item) => item.edge === 'below').length;
    cards.forEach((card, index) => {
      const item = geometry[index];
      if (!item) {
        return;
      }
      card.style.transform = `translate3d(0, ${item.y}px, 0) scale(${item.scale})`;
      card.style.zIndex = String(item.zIndex);
      card.dataset.edge = item.edge;
    });
  }
  private wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey || event.defaultPrevented) {
      return;
    }
    const driver = this.shadowRoot?.querySelector<WorkbenchScrollContainer>('.toast-scroll');
    if (driver) {
      // 滚动驱动器不命中指针；真实卡片把滚轮交给共享容器的平滑滚动引擎。
      driver.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: event.deltaY,
          deltaX: event.deltaX,
          deltaMode: event.deltaMode,
          cancelable: true,
        }),
      );
      event.preventDefault();
    }
  };
  private captureUnread() {
    this.unreadCohort = new Set(
      this.records.filter((record) => !record.read).map((record) => record.id),
    );
  }
  private selectFilter(filter: 'all' | 'unread' | 'read') {
    this.filter = filter;
    this.captureUnread();
    this.followHistory = true;
    this.requestUpdate();
  }
  private markVisibleRead() {
    if (!this.historyOpen) {
      return;
    }
    const history = this.shadowRoot?.querySelector<WorkbenchScrollContainer>('.history');
    const bounds = history?.scrollElement?.getBoundingClientRect();
    if (!bounds || bounds.height <= 0 || document.visibilityState === 'hidden') {
      return;
    }
    const visible = new Set(
      [
        ...(this.shadowRoot?.querySelectorAll<HTMLElement>('.notification[data-read="false"]') ??
          []),
      ]
        .filter((card) => {
          const rect = card.getBoundingClientRect();
          return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
        })
        .map((card) => card.dataset.id),
    );
    if (visible.size) {
      this.records = this.records.map((record) =>
        visible.has(record.id) ? { ...record, read: true } : record,
      );
      this.persist();
    }
  }
  private expand() {
    if (!this.expanded) {
      this.expanded = true;
    }
  }
  private collapse() {
    if (this.pointerInside || this.shadowRoot?.activeElement) {
      return;
    }
    this.expanded = false;
    // 展开/收起与滚动可能把条目从指针下移开，释放已失去悬停的暂停状态。
    for (const id of this.timers.ids) {
      this.resume(id, 'pointer');
    }
  }
  private card(record: ExtensionNotification, history = false) {
    const titles = { info: '通知', success: '成功', warn: '警告', error: '错误' };
    const glyphs = { info: 'info', success: 'pass', warn: 'warning', error: 'error' };
    return html`<article
      class=${history ? 'notification' : 'toast'}
      data-id=${record.id}
      data-type=${record.type}
      data-read=${String(record.read)}
      @mouseenter=${() => this.pause(record.id, 'pointer')}
      @mouseleave=${() => this.resume(record.id, 'pointer')}
      @focusin=${() => this.pause(record.id, 'focus')}
      @focusout=${(event: FocusEvent) => {
        if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
          this.resume(record.id, 'focus');
        }
      }}
    >
      <wb-icon
        class="notification-icon"
        name=${glyphs[record.type]}
        size="16"
        title=${titles[record.type]}
      ></wb-icon>
      <div class="body">
        <p>${record.message}</p>
        ${history
          ? html`<time datetime=${new Date(record.createdAt).toISOString()}
              >${new Date(record.createdAt).toLocaleString()}</time
            >`
          : ''}
        ${record.versionNotice?.status === 'warning'
          ? html`<button class="suppress" @click=${() => this.suppress(record)}>
              当前版本不再提示
            </button>`
          : ''}
      </div>
      <button
        class="close"
        aria-label="关闭通知"
        title="关闭通知"
        @click=${() => this.dismiss(record.id)}
      >
        ×
      </button>
    </article>`;
  }
  render() {
    if (this.historyOpen) {
      const records = this.records.filter(
        (record) =>
          this.filter === 'all' ||
          (this.filter === 'read' ? record.read : this.unreadCohort.has(record.id)),
      );
      return html`<nav class="history-filters" aria-label="通知筛选">
          ${(['all', 'unread', 'read'] as const).map(
            (filter) =>
              html`<button
                class=${this.filter === filter ? 'active' : ''}
                aria-pressed=${this.filter === filter}
                @click=${() => this.selectFilter(filter)}
              >
                ${{ all: '全部', unread: '未读', read: '已读' }[filter]}
              </button>`,
          )}
        </nav>
        <wb-scroll-container
          class="history"
          aria-label="通知历史"
          @scroll=${(event: CustomEvent<ScrollState>) => {
            if (event.detail) {
              this.followHistory = event.detail.maxScrollTop - event.detail.scrollTop < 2;
              this.markVisibleRead();
            }
          }}
        >
          <section class="history-list">
            ${records.length
              ? repeat(
                  records,
                  (record) => record.id,
                  (record) => this.card(record, true),
                )
              : html`<p class="empty">暂无通知</p>`}
          </section>
        </wb-scroll-container>`;
    }
    const active = this.active;
    if (!active.length) {
      return html``;
    }
    return html`<section
      class="floating"
      ?data-expanded=${this.expanded}
      aria-label="通知消息"
      @mouseenter=${() => {
        this.pointerInside = true;
        this.expand();
      }}
      @mouseleave=${() => {
        this.pointerInside = false;
        this.collapse();
      }}
      @focusin=${() => this.expand()}
      @focusout=${() => queueMicrotask(() => this.collapse())}
      @wheel=${this.wheel}
    >
      <wb-scroll-container
        class="toast-scroll"
        aria-hidden="true"
        inert
        .vertical=${{ size: 0 }}
        .horizontal=${{ size: 0 }}
        .stepDistance=${0}
        @scroll=${(event: CustomEvent<ScrollState>) => {
          if (event.detail) {
            this.placeCards(event.detail.scrollTop);
          }
        }}
      ></wb-scroll-container>
      <div class="cards" role="log" aria-live="polite">
        ${repeat(
          active,
          (record) => record.id,
          (record) => this.card(record),
        )}
      </div>
    </section>`;
  }
}
