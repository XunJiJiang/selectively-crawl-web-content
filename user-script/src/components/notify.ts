import style from './notify.css?raw';

import { customElement, state } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';
import { repeat } from 'lit/directives/repeat.js';
import type { INotifyOptions, TNotify } from '../types/notify.d.ts';
import { css, html, LitElement, noChange, nothing, unsafeCSS } from 'lit';
import { v4 as uuidv4 } from 'uuid';


class Notify {
  private static instance: SCWCNotify | null = null;

  constructor() {
    Notify.getInstance();
  }

  static getInstance () {
    if (!Notify.instance) {
      Notify.instance = document.createElement('scwc-notify');
      const notifyRoot = document.createElement('div');
      notifyRoot.className = 'scwc-notify-root';
      notifyRoot.style.cssText = `
        position: fixed;
        z-index: 2147483646;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
      `;
      notifyRoot.appendChild(Notify.instance);
      console.log('append notify root to body', Notify.instance);
      document.body.appendChild(notifyRoot);
    }
    return Notify.instance;
  }

  static notify (options: INotifyOptions) {
    Notify.getInstance().notify(options);
  }

  notify (options: INotifyOptions) {
    Notify.notify(options);
  }
}

const notifyClass = new Notify();

export const notify = (options: INotifyOptions) => {
  notifyClass.notify(options);
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
  static styles = [css`${unsafeCSS(style)}`];

  @state()
  private accessor infoList = {
    tl: new Map<string, TNotify>(),
    tr: new Map<string, TNotify>(),
    tc: new Map<string, TNotify>(),
    bl: new Map<string, TNotify>(),
    br: new Map<string, TNotify>(),
    bc: new Map<string, TNotify>(),
  }

  notify (options: INotifyOptions) {
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
      state: 'beforePreparation',
      ref: void 0,
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
      notifyItem.state = 'beforeLeave';
      this.updateNotifyOffsets(placement);
      return true;
    }
    return false;
  }

  /** 变化了的位置 */
  @state()
  private accessor changedPlacement = {
    tl: false,
    tr: false,
    tc: false,
    bl: false,
    br: false,
    bc: false,
  }

  /**
   * 当通知数量变化时，重新计算通知的 offset，并更新状态以触发重新渲染
   */
  private updateNotifyOffsets (placement: Required<INotifyOptions>['placement']) {
    this.changedPlacement[placement] = true;
    this.requestUpdate();
    console.log('update notify offsets');
  }

  render () {
    const lists = Object.entries(this.infoList) as ['tl' | 'tr' | 'tc' | 'bl' | 'br' | 'bc', Map<string, TNotify>][]
    console.log('render notify');
    return html`
      <div class="notify-container">
        ${lists.map(([placement, list]) => {
      if (this.changedPlacement[placement]) {
        this.changedPlacement[placement] = false;
      } else {
        return noChange;
      }
      const listValues = Array.from(list.values());
      return html`
        <div class="notify-list ${placement}-list">
          ${repeat(listValues, (item) => item.id, (item, idx) => {
        if (item.state === 'beforePreparation') {
          item.state = 'preparation';
          return html`
            <div class="notify-item preparation ${placement}-item  ${item.type}-item"
            ${ref((ele) => {
            item.ref = ele;
            if (ele) {
              // 刚添加到列表中, 尚未渲染到页面上, 需要隐式渲染计算高度
              // 获取到实际高度后，更新 notifyItem 的 height 属性，并调用 updateNotifyOffsets 以调整所有通知的位置
              const rect = ele.getBoundingClientRect();
              item.height = rect.height;
              item.state = 'beforeEnter';
              this.updateNotifyOffsets(placement);
            }
          })}
          >
              <div class="notify-title">
                <div class="notify-title-text">${item.title}</div>
                <!-- 此处不注册关闭事件, 因为处于隐式渲染状态 -->
                <div class="notify-close"></div>
              </div>
              <div class="notify-content">${item.description}</div>
            </div>
          `;
        } else if (item.state === 'beforeEnter') {
          return html`
            <div
              class="notify-item before-enter ${placement}-item ${item.type}-item"
              style=${(() => {
              // 获取上一个通知的 offset 和 height 以计算当前通知的 offset
              const prevItem = listValues[idx - 1];
              if (prevItem) {
                item.offset = prevItem.offset + prevItem.height + 8;
              } else {
                item.offset = 0;
              }
              return placement.startsWith('b') ? `bottom: ${item.offset}px;` : `top: ${item.offset}px;`;
            })()}
              ${ref((ele) => {
              item.ref = ele;
              requestAnimationFrame(() => {
                item.state = 'enter';
                if (ele) {
                  ele.classList.remove('before-enter');
                  ele.classList.add('enter');
                }
              })
            })}
            @click=${(e: MouseEvent) => {
              e.stopPropagation();
              item.onclick();
            }}
              >
              <div class="notify-title">
                <div class="notify-title-text">${item.title}</div>
                <div class="notify-close" @click=${(e: MouseEvent) => {
              e.stopPropagation();
              item.state = 'beforeLeave';
              this.handleNotifyClose(item.id, placement, 'user');
              item.onclose('user');
            }}></div>
              </div>
              <div class="notify-content">${item.description}</div>
            </div>
          `;
        } else if (item.state === 'beforeLeave') {
          return html`
            <div
              class="notify-item before-leave ${placement}-item ${item.type}-item"
              style=${placement.startsWith('b') ? `bottom: ${item.offset}px;` : `top: ${item.offset}px;`}
              ${ref((ele) => {
            item.ref = ele;
            requestAnimationFrame(() => {
              item.state = 'leave';
              if (ele) {
                ele.classList.remove('before-leave');
                ele.classList.add('leave');
                setTimeout(() => {
                  item.state = 'removed';
                  const notifyList = this.infoList[placement];
                  notifyList.delete(item.id);
                  // 更新后面通知的 offset
                  for (let i = idx + 1; i < listValues.length; i++) {
                    listValues[i].offset -= item.height + 8;
                    const ele = listValues[i].ref;
                    if (ele && ele instanceof HTMLElement) {
                      ele.style.transform = placement.startsWith('b') ? `bottom: ${listValues[i].offset}px;` : `top: ${listValues[i].offset}px;`;
                    }
                  }
                  this.updateNotifyOffsets(placement);
                }, 250 /* 此处应该根据离开动画的执行速度来执行 */)
              }
            })
          })}
          @click=${(e: MouseEvent) => {
              e.stopPropagation();
              item.onclick();
            }}
          >
              <div class="notify-title">
                <div class="notify-title-text">${item.title}</div>
                <!-- 此处不注册关闭事件, 因为已经进入关闭状态了 -->
                <div class="notify-close"></div>
              </div>
              <div class="notify-content">${item.description}</div>
            </div>
          `;
        } else if (item.state === 'removed') {
          return nothing;
        } else {
          return noChange;
        }
      })}
        </div>
      `})}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'scwc-notify': SCWCNotify;
  }
}