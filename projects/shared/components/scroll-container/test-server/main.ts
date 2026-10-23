import { html, render } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { SCWCScrollContainer } from '../index.ts';
import type {
  ScrollAxis,
  ScrollbarOptions,
  ScrollMetrics,
  ScrollMode,
  ScrollState,
  UpdateScrollMetrics,
  WheelDirection,
} from '../index.ts';
import { defaultScrollbar } from '../geometry.ts';

function element<T extends Element = HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) {
    throw new Error(`演示页缺少元素：${selector}`);
  }
  return found;
}

const input = (id: string) => element<HTMLInputElement>(`#${id}`);
const select = (id: string) => element<HTMLSelectElement>(`#${id}`);
const number = (id: string, fallback: number) => {
  const field = input(id);
  return field.value !== '' && Number.isFinite(field.valueAsNumber)
    ? field.valueAsNumber
    : fallback;
};
const format = (value: number) => Math.round(value * 10) / 10;
const playground = element<SCWCScrollContainer>('#playground');
const virtual = element<SCWCScrollContainer>('#virtual-demo');
const canvas = element('#demo-canvas');
const axes: ScrollAxis[] = ['horizontal', 'vertical'];
const axisOptions: Record<ScrollAxis, Required<ScrollbarOptions>> = {
  horizontal: { ...defaultScrollbar },
  vertical: { ...defaultScrollbar },
};
const fields: {
  key: keyof ScrollbarOptions;
  label: string;
  type: 'number' | 'text' | 'select';
  min?: number;
  max?: number;
  step?: number;
}[] = [
  { key: 'size', label: '轨道厚度 / px', type: 'number', min: 0 },
  { key: 'color', label: 'CSS 颜色', type: 'text' },
  { key: 'radius', label: '滑块圆角 / px', type: 'number', min: 0 },
  { key: 'opacity', label: '透明度 / 0–1', type: 'number', min: 0, max: 1, step: 0.05 },
  { key: 'fadeInDuration', label: '淡入时间 / ms', type: 'number', min: 0 },
  { key: 'fadeOutDuration', label: '淡出时间 / ms', type: 'number', min: 0 },
  { key: 'hideDelay', label: '隐藏延迟 / ms', type: 'number', min: 0 },
  { key: 'minThumbSize', label: '最小滑块长度 / px', type: 'number', min: 0 },
  { key: 'placement', label: '悬浮或占位', type: 'select' },
];

function renderAxisSettings() {
  render(
    axes.map(
      (axis) => html` <details open>
        <summary>
          ${axis === 'horizontal' ? '横向滚动条' : '纵向滚动条'}<span>${axis}</span>
        </summary>
        <div class="settings-body">
          ${fields.map(
            (field) => html` <label
              >${field.key}<span>${field.label}</span>
              ${field.type === 'select'
                ? html` <select
                    data-axis=${axis}
                    data-option=${field.key}
                    aria-label=${`${axis}.${field.key}`}
                  >
                    <option value="overlay" ?selected=${axisOptions[axis].placement === 'overlay'}>
                      overlay · 悬浮
                    </option>
                    <option value="gutter" ?selected=${axisOptions[axis].placement === 'gutter'}>
                      gutter · 占位
                    </option>
                  </select>`
                : html` <input
                    type=${field.type}
                    data-axis=${axis}
                    data-option=${field.key}
                    aria-label=${`${axis}.${field.key}`}
                    .value=${String(axisOptions[axis][field.key])}
                    min=${field.min ?? 0}
                    max=${field.max ?? 100000}
                    step=${field.step ?? 1}
                  />`}
            </label>`,
          )}
        </div>
      </details>`,
    ),
    element('#axis-settings'),
  );
}

function metricsStrip(target: string, state: Readonly<ScrollState>) {
  render(
    html`
      <span>视口<strong>${state.clientWidth} × ${state.clientHeight}</strong></span>
      <span>内容<strong>${state.scrollWidth} × ${state.scrollHeight}</strong></span>
      <span>位置<strong>${format(state.scrollLeft)}, ${format(state.scrollTop)}</strong></span>
      <span>范围<strong>${state.maxScrollLeft}, ${state.maxScrollTop}</strong></span>
    `,
    element(target),
  );
}

function updatePlaygroundReadout() {
  metricsStrip('#playground-metrics', playground.scrollState);
}

function updatePlaygroundCode() {
  element('#playground-code').textContent = `import '.../scroll-container/index.ts';

html\`<scwc-scroll-container
  style="width: ${input('viewport-width').value}px; height: ${input('viewport-height').value}px"
  .horizontal=\${${JSON.stringify(axisOptions.horizontal, null, 2)}}
  .vertical=\${${JSON.stringify(axisOptions.vertical, null, 2)}}
  scroll-behavior="${playground.scrollBehavior}"
  step-distance="${playground.stepDistance}"
  wheel-direction="${playground.wheelDirection}"
  shift-wheel-direction="${playground.shiftWheelDirection}"
  @scroll=\${(event) => console.log(event.detail)}
>
  <div style="width: ${input('content-width').value}px; height: ${input('content-height').value}px">
    <!-- slot 内容；支持容器与内容动态变更 -->
  </div>
</scwc-scroll-container>\`;`;
}

async function applyPlayground() {
  playground.horizontal = { ...axisOptions.horizontal };
  playground.vertical = { ...axisOptions.vertical };
  playground.scrollBehavior = select('behavior').value as ScrollMode;
  playground.stepDistance = Math.max(0, number('step', 40));
  playground.wheelDirection = select('wheel').value as WheelDirection;
  playground.shiftWheelDirection = select('shift-wheel').value as WheelDirection;
  playground.style.width = `${Math.max(120, number('viewport-width', 640))}px`;
  playground.style.height = `${Math.max(40, number('viewport-height', 300))}px`;
  canvas.style.width = `${Math.max(0, number('content-width', 1100))}px`;
  canvas.style.height = `${Math.max(0, number('content-height', 720))}px`;
  playground.classList.toggle('part-theme', input('part-theme').checked);
  await playground.updateComplete;
  playground.refresh();
  updatePlaygroundReadout();
  updatePlaygroundCode();
}

function setFields(values: Record<string, string | number>) {
  for (const [id, value] of Object.entries(values)) {
    element<HTMLInputElement | HTMLSelectElement>(`#${id}`).value = String(value);
  }
}

function preset(name: string) {
  axisOptions.horizontal = { ...defaultScrollbar };
  axisOptions.vertical = { ...defaultScrollbar };
  setFields({
    behavior: 'smooth',
    step: 40,
    wheel: 'auto',
    'shift-wheel': 'horizontal',
    'viewport-width': 640,
    'viewport-height': 300,
    'content-width': 1100,
    'content-height': 720,
  });
  playground.classList.toggle('tabs-mode', name === 'tabs');
  input('part-theme').checked = false;
  if (name === 'tabs') {
    setFields({
      behavior: 'instant',
      step: 60,
      wheel: 'horizontal',
      'viewport-height': 40,
      'content-width': 1800,
      'content-height': 40,
    });
    axisOptions.horizontal = { ...defaultScrollbar, size: 5, color: '#367c6b' };
  } else if (name === 'gutter') {
    axisOptions.horizontal = {
      ...defaultScrollbar,
      placement: 'gutter',
      size: 8,
      color: '#367c6b',
    };
    axisOptions.vertical = { ...defaultScrollbar, placement: 'gutter', size: 12, color: '#456e99' };
  } else if (name === 'fit') {
    setFields({ 'content-width': 300, 'content-height': 160 });
  }
  renderAxisSettings();
  void applyPlayground();
}

const log: { time: string; source: string; left: number; top: number }[] = [];
render(html`<li class="empty-log">滚动任意示例，查看位置和事件来源。</li>`, element('#event-log'));
function record(source: string, state: Readonly<ScrollState>) {
  log.unshift({
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    source,
    left: state.scrollLeft,
    top: state.scrollTop,
  });
  log.splice(24);
  render(
    log.map(
      (event) =>
        html`<li>
          <span class="event-time">${event.time}</span
          ><span class="event-source">${event.source}</span>left: ${format(event.left)} / top:
          ${format(event.top)}
        </li>`,
    ),
    element('#event-log'),
  );
}

let internalUpdate: UpdateScrollMetrics | undefined;
let retainedUpdate: UpdateScrollMetrics | undefined;
let virtualGeneration = 0;
let virtualInnerCount = 0;
let virtualOuterCount = 0;
let virtualMessage = '修改逻辑尺寸或位置，再点击应用。';
let logicalMetrics: Required<ScrollMetrics> = {
  scrollWidth: 1000,
  scrollHeight: 20000,
  scrollLeft: 0,
  scrollTop: 1200,
};
const rowHeight = 40;

virtual.content = (update) => {
  internalUpdate = update;
  if (update) {
    retainedUpdate = update;
  }
  const state = virtual.scrollState;
  const total = Math.ceil((state.scrollHeight || logicalMetrics.scrollHeight) / rowHeight);
  const first = Math.max(0, Math.floor(state.scrollTop / rowHeight) - 1);
  const last = Math.min(total, first + Math.ceil((state.clientHeight || 300) / rowHeight) + 3);
  const rows = Array.from({ length: Math.max(0, last - first) }, (_, index) => first + index);
  element('#rendered-rows').textContent = `${rows.length} 行 DOM / ${total} 行逻辑内容`;
  return html`<div
    style=${styleMap({
      position: 'relative',
      width: `${logicalMetrics.scrollWidth}px`,
      height: '1px',
    })}
  >
    ${rows.map(
      (row) =>
        html`<div
          data-virtual-row=${row}
          style=${styleMap({
            position: 'absolute',
            top: `${row * rowHeight}px`,
            left: '0',
            width: '100%',
            height: `${rowHeight}px`,
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
            padding: '0 18px',
            boxSizing: 'border-box',
            borderBottom: '1px solid #e6ecef',
            background: row % 2 === 0 ? '#f3f8f6' : '#fff',
            color: '#5b7a85',
            fontFamily: 'monospace',
            fontSize: '12px',
            whiteSpace: 'nowrap',
          })}
        >
          <span style="color:#8aafa3">${String(row + 1).padStart(4, '0')}</span
          ><span>虚拟内容行 ${row + 1}</span
          ><span style="color:#a0afb5">y = ${row * rowHeight}px · 仅渲染可见范围</span>
        </div>`,
    )}
  </div>`;
};

function updateVirtualReadout() {
  metricsStrip('#virtual-metrics', virtual.scrollState);
  element('#callback-status').textContent =
    `${internalUpdate ? '内部更新函数：已提供' : '内部更新函数：未提供（外部优先）'}\n${virtualMessage}`;
  element('#virtual-outer-count').textContent = String(virtualOuterCount);
  element('#virtual-inner-count').textContent = String(virtualInnerCount);
}

function updateVirtualCode() {
  const shared = `  .content=\${(updateMetrics) => {
    // 保存到内部列表，内部需要更新时再调用；不要在 render 中调用。
    list.updateMetrics = updateMetrics;
    return html\`<my-virtual-list></my-virtual-list>\`;
  }}
  .contentScroll=\${(state) => list.onScroll(state)}
  @scroll=\${(event) => console.log(event.detail)}`;
  element('#virtual-code').textContent =
    virtual.metrics === undefined
      ? `html\`<scwc-scroll-container style="height: 300px"
${shared}
></scwc-scroll-container>\`;

// 内部主动更新逻辑尺寸与位置：
list.updateMetrics?.(${JSON.stringify(logicalMetrics, null, 2)});`
      : `html\`<scwc-scroll-container style="height: 300px"
  .metrics=\${${JSON.stringify(virtual.metrics, null, 2)}}
${shared}
></scwc-scroll-container>\`;

// 外部 metrics 存在时，updateMetrics 为 undefined。
// 此前保存的内部更新函数仍可调用，但请求会被忽略。`;
}

async function applyVirtualMetrics() {
  const generation = ++virtualGeneration;
  logicalMetrics = {
    scrollWidth: Math.max(1, number('logical-width', 1000)),
    scrollHeight: Math.max(1, number('logical-height', 20000)),
    scrollLeft: Math.max(0, number('logical-left', 0)),
    scrollTop: Math.max(0, number('logical-top', 1200)),
  };
  const external = select('metrics-mode').value === 'external';
  virtual.metrics = external ? { ...logicalMetrics } : undefined;
  virtual.requestUpdate();
  await virtual.updateComplete;
  if (generation !== virtualGeneration) {
    return;
  }
  if (!external) {
    internalUpdate?.(logicalMetrics);
    await virtual.updateComplete;
  }
  virtualMessage = external
    ? '已应用外部 metrics；内部请求将被忽略。'
    : '已通过内部回调应用逻辑尺寸和位置。';
  updateVirtualReadout();
  updateVirtualCode();
}

virtual.contentScroll = (state) => {
  virtualInnerCount++;
  virtual.requestUpdate();
  updateVirtualReadout();
  record('contentScroll → 内部', state);
};
virtual.addEventListener('scroll', (event) => {
  const state = (event as CustomEvent<Readonly<ScrollState>>).detail;
  virtualOuterCount++;
  updateVirtualReadout();
  record('虚拟列表 → scroll', state);
});
playground.addEventListener('scroll', (event) => {
  updatePlaygroundReadout();
  record('试验台 → scroll', (event as CustomEvent<Readonly<ScrollState>>).detail);
});

element('#axis-settings').addEventListener('input', (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) {
    return;
  }
  const axis = field.dataset.axis as ScrollAxis;
  const key = field.dataset.option as keyof ScrollbarOptions;
  if (!axes.includes(axis) || !fields.some((option) => option.key === key)) {
    return;
  }
  const value =
    field instanceof HTMLInputElement && field.type === 'number'
      ? field.valueAsNumber
      : field.value;
  axisOptions[axis] = { ...axisOptions[axis], [key]: value };
  void applyPlayground();
});
for (const id of [
  'behavior',
  'step',
  'wheel',
  'shift-wheel',
  'viewport-width',
  'viewport-height',
  'content-width',
  'content-height',
  'part-theme',
]) {
  element(`#${id}`).addEventListener('input', () => void applyPlayground());
}
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) => {
  button.addEventListener('click', () => preset(button.dataset.preset ?? 'both'));
});
element('#reset').addEventListener('click', () => preset('both'));
element('#apply-metrics').addEventListener('click', () => void applyVirtualMetrics());
select('metrics-mode').addEventListener('change', () => void applyVirtualMetrics());
element('#retained-update').addEventListener('click', () => {
  if (virtual.metrics === undefined) {
    logicalMetrics = { ...logicalMetrics, scrollHeight: 8000, scrollTop: 320 };
  }
  retainedUpdate?.({ scrollHeight: 8000, scrollTop: 320 });
  virtualMessage =
    virtual.metrics === undefined
      ? '旧回调已生效：高度 8,000px、位置 320px。'
      : '旧回调已调用；外部 metrics 的尺寸和位置保持不变。';
  updateVirtualReadout();
  updateVirtualCode();
});

function showState() {
  element('#state-output').textContent = JSON.stringify(playground.scrollState, null, 2);
}
element('#scroll-options').addEventListener('click', () => {
  const behavior = select('api-behavior').value;
  playground.scrollTo({
    left: number('api-left', 0),
    top: number('api-top', 0),
    ...(behavior === 'inherit' ? {} : { behavior: behavior as ScrollBehavior }),
  });
  showState();
});
element('#scroll-coordinates').addEventListener('click', () => {
  playground.scrollTo(number('api-left', 0), number('api-top', 0));
  showState();
});
element('#read-state').addEventListener('click', showState);
element('#refresh').addEventListener('click', () => {
  playground.refresh();
  updatePlaygroundReadout();
  showState();
});
element('#focus-viewport').addEventListener('click', () => playground.scrollElement?.focus());
element('#clear-events').addEventListener('click', () => {
  log.length = 0;
  render(html`<li class="empty-log">记录已清空。滚动示例查看新事件。</li>`, element('#event-log'));
});

const observer = new ResizeObserver(() =>
  requestAnimationFrame(() => {
    updatePlaygroundReadout();
    updateVirtualReadout();
  }),
);
observer.observe(playground);
observer.observe(canvas);
observer.observe(virtual);

const motion = matchMedia('(prefers-reduced-motion: reduce)');
const updateMotionNote = () => {
  element('#motion-note').textContent = motion.matches
    ? '系统当前启用了减少动态效果：淡入淡出和平滑动画会被关闭。'
    : '';
};
motion.addEventListener('change', updateMotionNote);
updateMotionNote();

render(
  Array.from(
    { length: 12 },
    (_, index) =>
      html`<div class="sample-card">
        <small>内容区域 / ${String(index + 1).padStart(2, '0')}</small
        ><strong>${(index + 1) * 128}</strong>
        <div class="sample-line"></div>
        <div class="sample-line" style="width:45%"></div>
      </div>`,
  ),
  element('#sample-grid'),
);
renderAxisSettings();
await applyPlayground();
await applyVirtualMetrics();
showState();
