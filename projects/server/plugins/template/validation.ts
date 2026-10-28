import { FeedbackDemo, feedbackActions, type FeedbackAction } from './feedback-demo.ts';

interface ProbeEvent {
  at: string;
  message: string;
}
const events: ProbeEvent[] = [];
const active = new Set<string>();
const sockets = new Map<string, () => void>();
let attempt = 0;
let feedback: FeedbackDemo | undefined;
const record = (message: string) => {
  events.push({ at: new Date().toISOString(), message });
  if (events.length > 120) events.shift();
};

export function loadValidation(workbench: SCWC.ILoadContext['workbench']) {
  // onLoad 只保存工厂，不在插件加载时自动弹通知或创建任务。
  feedback = new FeedbackDemo(workbench, '后端', (message) => record(`feedback ${message}`));
}
export async function unloadValidation() {
  for (const close of sockets.values()) close();
  sockets.clear();
  await feedback?.dispose();
  feedback = undefined;
}

function delay(query: Record<string, unknown>) {
  const ms = Number(query.ms ?? 90000);
  if (!Number.isInteger(ms) || ms < 0 || ms > 180000) throw new Error('ms 需要是 0–180000 的整数');
  return ms;
}
async function probe(kind: string, query: Record<string, unknown>) {
  const ms = delay(query);
  const run = String(query.run ?? '').slice(0, 64);
  const id = `${kind}#${++attempt}`;
  active.add(id);
  record(`${id} started run=${run} delay=${ms}ms`);
  try {
    // 只延迟只读响应；被 SDK 重放也不会重复执行业务写入。
    // 浏览器 abort 不等于后端已取消：同一 run 的不同 attempt 可用于观察重发。
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    record(`${id} finished run=${run}`);
    return { id, run, ms, completedAt: new Date().toISOString() };
  } finally {
    active.delete(id);
  }
}

export const validationApis: SCWC.TPluginApi[] = [
  {
    method: 'GET',
    path: '/validation/delay',
    handler: (_data, { request }) => probe('fetch', request.query),
  },
  {
    method: 'GET',
    path: '/validation/events',
    handler: () => ({ active: [...active], connections: [...sockets.keys()], events: [...events] }),
  },
  {
    method: 'POST',
    path: '/validation/feedback',
    handler: async (data) => {
      const action = data && typeof data === 'object' && 'action' in data ? data.action : undefined;
      if (!feedback) throw new Error('onLoad 尚未注入 workbench');
      if (!feedbackActions.includes(action as FeedbackAction)) throw new Error('未知验证操作');
      return feedback.run(action as FeedbackAction);
    },
  },
];

export const validationResources: SCWC.TPluginResource[] = [
  {
    path: '/validation/image.svg',
    handler: async (_data, { request }) => {
      const result = await probe('resource', request.query);
      // 生成的固定 SVG 没有敏感数据，无需另发资源票据。禁止嵌入用户输入或任意文件。
      return {
        kind: 'response',
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' },
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80"><rect width="320" height="80" rx="4" fill="#0f131c"/><text x="16" y="46" fill="#38bdf8" font-family="monospace" font-size="16">${result.id} loaded</text></svg>`,
      };
    },
  },
];

export const validationSockets: SCWC.TPluginWebSocket[] = [
  {
    path: '/validation/socket',
    onConnect: (context) => {
      const id = context.connectionId;
      let sequence = 0;
      record(`socket ${id} connected`);
      const send = () =>
        context.send({ connectionId: id, sequence: ++sequence, at: new Date().toISOString() });
      send();
      const timer = setInterval(send, 2000);
      const cleanup = () => {
        clearInterval(timer);
        sockets.delete(id);
      };
      sockets.set(id, cleanup);
      return cleanup;
    },
    onMessage: (data, context) =>
      context.send({ connectionId: context.connectionId, echo: String(data) }),
    onClose: ({ connectionId }) => {
      sockets.get(connectionId)?.();
      record(`socket ${connectionId} closed`);
    },
  },
];
