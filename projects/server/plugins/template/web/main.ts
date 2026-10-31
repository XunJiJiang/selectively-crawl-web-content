import { LitElement, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { FeedbackDemo, type FeedbackAction, type FeedbackSnapshot } from '../feedback-demo.ts';
import './styles.css';
import { PageUIDemo } from './ui-demo.ts';

type Source = '前端' | '后端';
type ExternalState = ReturnType<Window['scwcutils']['externalState']['get']>;
interface ImageProbe {
  id: string;
  url: string;
  interruptible: boolean;
}
interface LogEntry {
  at: string;
  text: string;
  error?: boolean;
}

class TemplateValidation extends LitElement {
  private sdk?: Window['scwcutils'];
  private feedback?: FeedbackDemo;
  private ready = false;
  private error = '';
  private external?: ExternalState;
  private source: Source = '前端';
  private snapshots: Partial<Record<Source, FeedbackSnapshot>> = {};
  private busy = false;
  private duration = 90000;
  private pending = new Map<string, AbortController>();
  private images: ImageProbe[] = [];
  private socket?: WebSocket;
  private socketState = '未连接';
  private heartbeat = 0;
  private suspended = false;
  private ticker?: ReturnType<typeof setInterval>;
  private disposers: (() => void)[] = [];
  private logs: LogEntry[] = [];
  private uiDemo?: PageUIDemo;

  // 核心 ManagedResources 观察 document 中的 src/href，不能把验证资源藏在 Shadow DOM。
  // 本例显式 requestUpdate，避免依赖装饰器或外层 tsconfig 的字段转换方式。
  protected createRenderRoot() {
    return this;
  }
  connectedCallback() {
    super.connectedCallback();
    void this.initialize();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.ticker);
    for (const dispose of this.disposers) dispose();
    for (const controller of this.pending.values()) controller.abort();
    this.socket?.close();
    this.feedback?.cancelPendingSystemNotices();
    void this.uiDemo?.dispose();
    // 文档离开时 SDK 的 feedback/release 负责回收所属任务与回调。
  }

  private log(text: string, error = false) {
    this.logs = [{ at: new Date().toLocaleTimeString(), text, error }, ...this.logs].slice(0, 80);
    this.requestUpdate();
  }
  private startTicker() {
    clearInterval(this.ticker);
    this.ticker = setInterval(() => {
      this.heartbeat++;
      this.requestUpdate();
    }, 1000);
  }
  private async initialize() {
    try {
      const sdk = window.scwcutils;
      if (!sdk)
        throw new Error('请构建后从核心工作台打开；独立 Vite 开发服务器不会注入 scwcutils。');
      this.sdk = sdk;
      await sdk.ready; // resource/websocket 是同步工厂，必须等待授权。
      if (sdk.host.capabilities.pageApiVersion !== 2 || !sdk.ui?.handlers)
        throw new Error(
          '核心注入的 scwcutils 构建产物过期：本模板要求 pageApiVersion=2 和 ui.handlers。请由核心维护者重建 webutils 后刷新页面。',
        );
      if (!this.isConnected) return;
      this.uiDemo = new PageUIDemo(
        sdk,
        () => this.requestUpdate(),
        (message, error) => this.log(message, error),
      );
      this.external = sdk.externalState.get();
      this.disposers.push(
        sdk.externalState.onChange(() => {
          this.external = sdk.externalState.get();
          this.log(`externalState ${JSON.stringify(this.external)}`);
        }),
      );
      const theme = () => {
        document.documentElement.dataset.theme = sdk.theme.mode;
        for (const [name, value] of Object.entries(sdk.theme.tokens))
          document.documentElement.style.setProperty(name, value);
      };
      theme();
      this.disposers.push(sdk.theme.onChange(theme));
      this.disposers.push(
        sdk.lifecycle.register({
          onSuspend: () => {
            clearInterval(this.ticker);
            this.suspended = true;
            this.log('lifecycle.onSuspend：心跳停止');
          },
          onResume: () => {
            this.suspended = false;
            this.startTicker();
            this.log('lifecycle.onResume：心跳恢复');
          },
          canLeave: () =>
            !this.uiDemo?.snapshot().dirty || window.confirm('配置草稿尚未提交，仍要离开？'),
          serialize: () => ({
            heartbeat: this.heartbeat,
            logs: this.logs,
            ui: this.uiDemo?.snapshot(),
          }),
          restore: (value) => {
            const state = value as { heartbeat?: number; logs?: LogEntry[]; ui?: unknown } | null;
            this.uiDemo?.restore(state?.ui);
            this.heartbeat = state?.heartbeat ?? 0;
            this.logs = state?.logs?.slice(0, 80) ?? [];
            this.log('lifecycle.restore：恢复心跳计数和事件记录');
          },
        }).dispose,
      );
      this.feedback = new FeedbackDemo(sdk, '前端', (message) => this.log(`前端 ${message}`));
      const pageTitle = await sdk.ui.handlers.register('template.title', {
        readOnly: true,
        run() {
          return document.title || '模板 · 接入验证';
        },
        watch(_args, emit) {
          const observer = new MutationObserver(() => emit(document.title));
          observer.observe(document.head, { childList: true, subtree: true, characterData: true });
          return () => observer.disconnect();
        },
      });
      this.disposers.push(() => void pageTitle.dispose());
      await this.uiDemo.initialize();
      this.disposers.push(
        sdk.config.subscribe(['validation.note'], (change) =>
          this.log(`配置通知 revision ${change.revision}`),
        ),
      );
      this.ready = true;
      this.startTicker();
      this.log('SDK ready；未自动创建任务、通知或网络轮询');
    } catch (error) {
      this.error = String(error);
    }
    this.requestUpdate();
  }

  private async run(action: FeedbackAction, source: Source = this.source) {
    if (!this.sdk || !this.feedback || this.busy) return;
    this.busy = true;
    this.requestUpdate();
    try {
      if (source === '前端') this.snapshots[source] = await this.feedback.run(action);
      else {
        const response = await this.sdk.fetch<FeedbackSnapshot>('/validation/feedback', {
          method: 'POST',
          body: JSON.stringify({ action }),
          // 查询可重发；创建和更新有副作用，保持默认不可中断。
          ...(action === 'inspect' ? { interruptible: true } : {}),
        });
        if (!response.success) throw new Error(response.message);
        this.snapshots[source] = response.data;
      }
      this.log(`${source} ${action} 完成`);
    } catch (error) {
      this.log(`${source} ${action}：${error}`, true);
    } finally {
      this.busy = false;
      this.requestUpdate();
    }
  }

  private async fetchProbe(interruptible: boolean) {
    if (!this.sdk) return;
    const id = crypto.randomUUID();
    const controller = new AbortController();
    this.pending.set(id, controller);
    this.log(
      `fetch ${id.slice(0, 8)} 开始，${interruptible ? '可中断' : '默认保护'}，${this.duration}ms`,
    );
    try {
      const response = await this.sdk.fetch(`/validation/delay?ms=${this.duration}&run=${id}`, {
        signal: controller.signal,
        // 不给普通请求显式 false，用缺省值验证“未标记即保护”。
        ...(interruptible ? { interruptible: true } : {}),
      });
      if (!response.success) throw new Error(response.message);
      this.log(`fetch ${id.slice(0, 8)} 返回 ${JSON.stringify(response.data)}`);
    } catch (error) {
      this.log(
        `fetch ${id.slice(0, 8)} ${controller.signal.aborted ? '调用方取消（不会重发）' : String(error)}`,
        !controller.signal.aborted,
      );
    } finally {
      this.pending.delete(id);
      this.requestUpdate();
    }
  }

  private imageProbe(interruptible: boolean) {
    if (!this.sdk || this.images.length >= 4) return;
    const id = crypto.randomUUID();
    const url = this.sdk.resource(
      `/validation/image.svg?ms=${this.duration}&run=${id}`,
      interruptible ? { interruptible: true } : undefined,
    );
    // 必须真正绑定 DOM src 才会开始请求；单纯生成 resource URL 不应保护连接。
    this.images = [...this.images, { id, url, interruptible }];
    this.log(`resource ${id.slice(0, 8)} 绑定 src，${interruptible ? '可中断' : '默认保护'}`);
  }
  private openSocket(interruptible: boolean) {
    if (!this.sdk || this.socket) return;
    const socket = this.sdk.websocket(
      '/validation/socket',
      undefined,
      interruptible ? { interruptible: true } : undefined,
    );
    this.socket = socket;
    this.socketState = '连接中';
    socket.onopen = () => {
      this.socketState = interruptible ? '已连接 · 可中断' : '已连接 · 默认保护';
      this.log('socket open（恢复后应再次触发）');
    };
    socket.onmessage = (event) => this.log(`socket ${event.data}`);
    socket.onerror = () => {
      this.socketState = '连接错误';
      this.log('socket error', true);
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = undefined;
      this.socketState = '已关闭';
      this.log('socket close');
    };
    this.requestUpdate();
  }
  private closeSocket() {
    this.socket?.close(); // 手动 close 之后不应随核心重连复活。
    this.socket = undefined;
    this.socketState = '手动关闭';
    this.log('socket 手动关闭');
  }
  private async events() {
    try {
      const result = await this.sdk!.fetch('/validation/events', { interruptible: true });
      if (!result.success) throw new Error(result.message);
      this.log(`后端证据 ${JSON.stringify(result.data)}`);
    } catch (error) {
      this.log(String(error), true);
    }
  }
  private async build() {
    try {
      const pluginId = decodeURIComponent(location.pathname.split('/')[4]);
      const task = await this.sdk!.tasks.start(pluginId, 'build-ui');
      this.log(`内置 build-ui 已受理 ${task.id}；在底部任务按钮查看完成状态`);
    } catch (error) {
      this.log(`build-ui：${error}`, true);
    }
  }
  private button(label: string, action: () => unknown, disabled = false) {
    return html`<button ?disabled=${!this.ready || disabled} @click=${action}>${label}</button>`;
  }
  private action(label: string, action: FeedbackAction) {
    return this.button(label, () => this.run(action), this.busy);
  }
  private value(value: boolean | undefined) {
    return value === undefined ? '无值' : value ? '是' : '否';
  }

  render() {
    const snapshot = this.snapshots[this.source];
    return html` <header class="page-header">
        <div class="brand-mark" aria-hidden="true">◇</div>
        <div>
          <div class="eyebrow">SCWC / TEMPLATE</div>
          <h1>插件接入验证</h1>
          <p>从真实插件通道检查页面、请求与反馈。</p>
        </div>
        <span class="badge ${this.ready ? 'online' : ''}"
          >${this.ready ? 'SDK 已就绪' : '等待 SDK'}</span
        >
      </header>
      ${this.error ? html`<p class="error-banner" role="alert">${this.error}</p>` : nothing}
      <main>
        <section class="panel">
          <div class="section-heading">
            <h2>01 <span>页面状态</span></h2>
            <span class="caption">externalState + lifecycle</span>
          </div>
          <div class="metrics">
            ${[
              ['工作台中打开', this.external?.inWorkbench],
              ['浏览器直接打开', this.external?.inBrowser],
              ['宿主聚焦', this.external?.focused],
              ['宿主可见', this.external?.visible],
            ].map(
              ([name, value]) =>
                html`<div class="metric">
                  <span>${name}</span><strong>${this.value(value as boolean | undefined)}</strong>
                </div>`,
            )}
          </div>
          <div class="inline-status">
            <span class="status-dot"></span>本地心跳 ${this.heartbeat} ·
            ${this.suspended ? '已暂停' : '活动中'}<a
              href=${location.href}
              target="_blank"
              rel="noopener"
              >在浏览器中直接打开 ↗</a
            >
          </div>
          <p class="hint">
            工作台内切换焦点与标签页，观察状态事件；直接打开时 focused / visible 应为无值。隐藏超过
            30 秒后观察暂停，未完成的保护请求应延后暂停。
          </p>
        </section>
        <div class="columns">
          <section class="panel">
            <div class="section-heading">
              <h2>02 <span>请求生命周期</span></h2>
              <span class="caption">默认保护 / 显式可中断</span>
            </div>
            <label class="duration"
              >延时响应（秒）<input
                type="number"
                min="1"
                max="180"
                .value=${String(this.duration / 1000)}
                @change=${(e: Event) => {
                  const n = Number((e.target as HTMLInputElement).value);
                  this.duration = Math.round(Math.min(180, Math.max(1, n || 90)) * 1000);
                  this.requestUpdate();
                }}
            /></label>
            <div class="probe-row">
              <div>
                <h3>Fetch</h3>
                <p>等待中的请求 ${this.pending.size} 个，可同时发起以验证倒计时重置。</p>
              </div>
              <div class="buttons">
                ${this.button('默认保护', () => this.fetchProbe(false))}${this.button(
                  '可中断',
                  () => this.fetchProbe(true),
                )}${this.button(
                  '取消全部',
                  () => {
                    for (const c of this.pending.values()) c.abort();
                  },
                  !this.pending.size,
                )}
              </div>
            </div>
            <div class="probe-row">
              <div>
                <h3>Resource</h3>
                <p>延时 SVG 图片；最多保留 4 个 DOM 资源。</p>
              </div>
              <div class="buttons">
                ${this.button(
                  '默认保护',
                  () => this.imageProbe(false),
                  this.images.length >= 4,
                )}${this.button(
                  '可中断',
                  () => this.imageProbe(true),
                  this.images.length >= 4,
                )}${this.button(
                  '移除资源',
                  () => {
                    this.images = [];
                    this.log('resource DOM 已移除');
                  },
                  !this.images.length,
                )}
              </div>
            </div>
            <div class="resources">
              ${repeat(
                this.images,
                (item) => item.id,
                (item) =>
                  html`<figure>
                    <img
                      src=${item.url}
                      alt="延时验证图片"
                      @load=${() => this.log(`resource ${item.id.slice(0, 8)} load`)}
                      @error=${() =>
                        this.log(
                          `resource ${item.id.slice(0, 8)} error（暂停期间需结合网络面板判断）`,
                        )}
                    />
                    <figcaption>
                      ${item.interruptible ? '可中断' : '默认保护'} · ${item.id.slice(0, 8)}
                    </figcaption>
                  </figure>`,
              )}
            </div>
            <div class="probe-row">
              <div>
                <h3>WebSocket</h3>
                <p>${this.socketState} · 每 2 秒发送连接编号与序号。</p>
              </div>
              <div class="buttons">
                ${this.button(
                  '默认保护',
                  () => this.openSocket(false),
                  Boolean(this.socket),
                )}${this.button(
                  '可中断',
                  () => this.openSocket(true),
                  Boolean(this.socket),
                )}${this.button(
                  '发送 echo',
                  () => this.socket?.send('template echo'),
                  this.socket?.readyState !== 1,
                )}${this.button('关闭', () => this.closeSocket(), !this.socket)}
              </div>
            </div>
            <p class="hint">
              启用核心节能设置后等待空闲断连，重新交互触发连接恢复。普通浏览器隐藏不等于核心断连；不要使用离线模式代替空闲断连验收。
            </p>
            ${this.button('读取后端请求证据', () => this.events())}
          </section>
          <section class="panel">
            <div class="section-heading">
              <h2>03 <span>任务与通知</span></h2>
              <div class="segments" aria-label="控制对象来源">
                ${(['前端', '后端'] as const).map(
                  (source) =>
                    html`<button
                      class=${source === this.source ? 'selected' : ''}
                      ?disabled=${this.busy}
                      @click=${() => {
                        this.source = source;
                        this.requestUpdate();
                      }}
                    >
                      ${source}
                    </button>`,
                )}
              </div>
            </div>
            <p class="hint">
              ${this.source === '前端'
                ? '通过 scwcutils.logger / tasks 创建，回调在本页面执行。'
                : '通过 onLoad 注入的 workbench 创建，回调在插件宿主执行。'}
            </p>
            <h3>任务控制对象 <span class="caption">${snapshot?.task?.status ?? '未创建'}</span></h3>
            <div class="buttons">
              ${this.action('创建任务', 'task.create')}${this.action(
                '开始',
                'task.run',
              )}${this.action('进度 50%', 'task.progress')}${this.action(
                '更新内容',
                'task.content',
              )}${this.action('成功', 'task.succeed')}${this.action(
                '失败',
                'task.fail',
              )}${this.action('取消', 'task.cancel')}
            </div>
            <p class="hint">
              创建后窗口不应自动打开；运行、完成未读、打开后已读，分别观察底部通知按钮左侧的任务图标。
            </p>
            <h3>
              通知控制对象
              <span class="caption"
                >${snapshot?.notification
                  ? snapshot.notification.readAt
                    ? '已读'
                    : '未读'
                  : '未创建'}</span
              >
            </h3>
            <div class="buttons">
              ${this.action('创建通知', 'notice.create')}${this.action(
                '更新内容',
                'notice.content',
              )}${this.action('不定进度', 'notice.loading')}${this.action(
                '进度 50%',
                'notice.progress',
              )}${this.action('隐藏进度条', 'notice.hide')}${this.action(
                '替换 4 个按钮',
                'notice.actions',
              )}${this.action('标为已读', 'notice.read')}${this.action(
                '恢复未读',
                'notice.unread',
              )}${this.action('主动关闭', 'notice.close')}
            </div>
            <p class="hint">
              浮层和通知中心底部应显示等宽 4px
              加载条。autoRead=false；点击通知中的按钮验证回调，替换后检查按钮文案和行为。
            </p>
            <div class="buttons">
              ${this.button(
                '前端：3 秒后发送系统通知',
                () => this.run('notice.system', '前端'),
                this.busy,
              )}${this.button(
                '后端：3 秒后发送系统通知',
                () => this.run('notice.system', '后端'),
                this.busy,
              )}
            </div>
            <p class="hint">
              点击后可切换到其他窗口。三秒后对应端发送通知；工作台失焦且系统通知已授权时会提升显示。
            </p>
            <div class="inspect-row">
              ${this.action('查询控制对象', 'inspect')}<span class="caption"
                >通知中心可见：${this.value(snapshot?.visible ?? undefined)}</span
              >
            </div>
            <details>
              <summary>最近一次查询结果</summary>
              <pre>${JSON.stringify(snapshot ?? {}, null, 2)}</pre>
            </details>
            <div class="built-in">
              ${this.button('运行内置页面构建任务', () => this.build())}
              <p class="hint">
                调用 tasks.start(当前插件, 'build-ui')。重建页面资源后需要手动刷新。
              </p>
            </div>
          </section>
        </div>
        ${this.uiDemo?.render() ?? nothing}
        <section class="panel event-panel">
          <div class="section-heading">
            <h2>05 <span>事件记录</span></h2>
            <button
              @click=${() => {
                this.logs = [];
                this.requestUpdate();
              }}
            >
              清空显示
            </button>
          </div>
          <p class="hint">
            只记录真实调用结果，不据按钮点击判定通过。没有后台网络轮询，以免干扰空闲倒计时；查询按钮本身会恢复活动。
          </p>
          <ol class="event-list" aria-label="事件记录">
            ${this.logs.map(
              (entry) =>
                html`<li class=${entry.error ? 'event-error' : ''}>
                  <time>${entry.at}</time><code>${entry.text}</code>
                </li>`,
            )}
          </ol>
        </section>
      </main>
      <footer>Vite + Lit · 仅使用核心公开插件接口 · 完整验收步骤见模板 README</footer>`;
  }
}
customElements.define('template-validation', TemplateValidation);
