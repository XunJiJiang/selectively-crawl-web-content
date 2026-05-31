import { customElement, state } from 'lit/decorators.js';
import type { INotifyOptions, TNotify } from '../types/notify.d.ts';
import { css, html, LitElement } from 'lit';
import { v4 as uuidv4 } from 'uuid';

export const notify = (options: INotifyOptions) => {
  SCWCNotify.notify(options);
}

const defaultNotifyOptions: Omit<Required<INotifyOptions>, 'title'> = {
  description: '',
  type: 'info',
  placement: 'tr',
  duration: 3000,
  onclose: () => {},
  onclick: () => {},
}

@customElement('scwc-notify')
class SCWCNotify extends LitElement {
  private static instance: SCWCNotify | null = null;

  static getInstance () {
    if (!SCWCNotify.instance) {
      SCWCNotify.instance = document.createElement('scwc-notify') as SCWCNotify;
      document.body.appendChild(SCWCNotify.instance);
    }
    return SCWCNotify.instance;
  }

  static notify (options: INotifyOptions) {
    SCWCNotify.getInstance().notify(options);
  }

  static styles = css`
    :host {
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
    }
  `

  @state()
  infoList = {
    tl: new Map<string, TNotify>(),
    tr: new Map<string, TNotify>(),
    tc: new Map<string, TNotify>(),
    bl: new Map<string, TNotify>(),
    br: new Map<string, TNotify>(),
    bc: new Map<string, TNotify>(),
  }

  private notify (options: INotifyOptions) {
    const notifyOptions = { ...defaultNotifyOptions, ...options };
    const placement = notifyOptions.placement ?? defaultNotifyOptions.placement;
    const notifyItem: TNotify = {
      ...notifyOptions,
      id: uuidv4(),
      idx: this.infoList[placement].size,
      timeoutId: void 0,
      offset: 0,
      // TODO: 需要替换为实际的通知高度和间距计算方式
      // 当 height 为 0 时，不需要考虑通知之间的间距，直接将新通知渲染在可视区域外，获取到实际高度后再更新位置
      height: 0,
      // TODO: 需要在通知渲染后获取实际高度, 当 height 为 0 时，表示尚未获取到高度，需要先渲染到可视区域外
      // 获取到实际高度后，更新 notifyItem 的 height 属性，并调用 updateNotifyOffsets 以调整所有通知的位置
    }
    this.infoList[notifyOptions.placement].set(notifyItem.id, notifyItem);
    notifyItem.timeoutId = setTimeout(() => {
      notifyItem.timeoutId = void 0;
      this.handleNotifyClose(notifyItem.id, placement, 'auto');
    }, notifyOptions.duration);

    this.updateNotifyOffsets(placement);

    return {
      id: notifyItem.id,
      /**
       * 主动关闭通知，不会触发自动关闭或用户关闭的回调函数
       */
      close: () => {
        return this.handleNotifyClose(notifyItem.id, placement, 'manual');
      },
    }
  }

  private handleNotifyClose (id: string, placement: NonNullable<INotifyOptions['placement']>, source: 'auto' | 'user' | 'manual') {
    const notifyItem = this.infoList[placement].get(id);
    if (notifyItem) {
      if (source !== 'manual') {
        notifyItem.onclose(source);
      }
      clearTimeout(notifyItem.timeoutId);
      this.infoList[placement].delete(id);
      this.updateNotifyOffsets(placement);
      return true;
    }
    return false;
  }

  /**
   * 当通知数量变化时，重新计算通知的 offset，并更新状态以触发重新渲染
   */
  private updateNotifyOffsets (placement: Required<INotifyOptions>['placement']) {

  }

  render () {
    const lists = Object.entries(this.infoList) as ['tl' | 'tr' | 'tc' | 'bl' | 'br' | 'bc', Map<string, TNotify>][]

    return html`
      <div class="notify-container">
        ${lists.map(([placement, list]) => html`
          <div class="notify-list ${placement}">
            ${Array.from(list.values()).map(item => html`
            `)}
          </div>
        `)}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scwc-notify': SCWCNotify;
  }
}