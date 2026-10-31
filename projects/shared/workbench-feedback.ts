/** Percentage (0–100), null for indeterminate loading, false to hide the bar. */
export type FeedbackProgress = number | null | false;
export type NotificationLevel = 'info' | 'success' | 'warn' | 'error';
export interface NotificationAction {
  label: string;
  onClick: () => unknown;
}
export interface NotificationOptions {
  message?: string;
  dedupeKey?: string;
  target?: { pluginPath: string };
  progress?: FeedbackProgress;
  /** False leaves reading to markRead() or an explicit user action. */
  autoRead?: boolean;
  /** Also show a system notification when the receiving application is unfocused. */
  systemNotification?: boolean;
  actions?: NotificationAction[];
}
export interface NotificationUpdate extends Omit<NotificationOptions, 'dedupeKey'> {
  title?: string;
  level?: NotificationLevel;
}
export interface FeedbackOwner {
  source: 'core' | 'plugin' | 'page';
  pluginId: string | null;
  tabId?: string;
  /** Binds controls to one backend host or page document. */
  ownerId?: string;
  executionId?: string;
}
export interface NotificationState {
  id: string;
  source: string;
  pluginId: string | null;
  tabId?: string;
  ownerId?: string;
  level: string;
  title: string;
  message: string;
  readAt: string | null;
  updatedAt: string;
  count: number;
  progress?: FeedbackProgress;
  autoRead?: boolean;
  systemNotification?: boolean;
  visible?: boolean;
  seenAt?: string | null;
  actions: { type: string; path?: string; id?: string; label?: string }[];
}
export interface NotificationController {
  readonly id: string;
  update(value: NotificationUpdate): Promise<NotificationState>;
  setContent(title: string, message?: string): Promise<NotificationState>;
  setProgress(progress: FeedbackProgress): Promise<NotificationState>;
  setActions(actions: NotificationAction[]): Promise<NotificationState>;
  markRead(read?: boolean): Promise<NotificationState>;
  getState(): Promise<NotificationState>;
  isVisible(): Promise<boolean>;
  close(): Promise<void>;
}
export interface NotificationLogger {
  create(
    options: NotificationOptions & { title: string; level?: NotificationLevel },
  ): Promise<NotificationController>;
  info(title: string, options?: NotificationOptions): Promise<NotificationController>;
  success(title: string, options?: NotificationOptions): Promise<NotificationController>;
  warn(title: string, options?: NotificationOptions): Promise<NotificationController>;
  error(title: string, options?: NotificationOptions): Promise<NotificationController>;
}
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled';
export interface TaskOptions {
  title: string;
  type?: string;
  status?: TaskStatus;
  phase?: string;
  content?: string;
  progress?: FeedbackProgress;
  error?: string;
}
export type TaskUpdate = Partial<TaskOptions> & { log?: { level?: string; text: string } };
export interface TaskState {
  id: string;
  pluginId: string;
  type: string;
  title?: string;
  content?: string;
  progress?: FeedbackProgress;
  status: TaskStatus;
  phase: string;
  revision: number;
  logs: { seq: number; level?: string; text?: string; message?: string }[];
  error?: string;
  createdAt?: string;
  readAt?: string | null;
  owner?: FeedbackOwner;
}
export interface TaskController {
  readonly id: string;
  update(value: TaskUpdate): Promise<TaskState>;
  setProgress(progress: FeedbackProgress): Promise<TaskState>;
  setContent(content: string): Promise<TaskState>;
  succeed(content?: string): Promise<TaskState>;
  fail(error: string): Promise<TaskState>;
  cancel(): Promise<TaskState>;
  getState(): Promise<TaskState>;
}
export interface TaskManager {
  create(options: TaskOptions): Promise<TaskController>;
  start(
    pluginId: string,
    type: 'rescan' | 'enable' | 'disable' | 'once-disable' | 'reload' | 'build-ui',
  ): Promise<TaskController>;
}
export type FeedbackRequest = <T>(path: string, body?: unknown) => Promise<T>;

/** Functions stay in their originating process/document; only IDs cross transports. */
export function createFeedbackClient(
  request: FeedbackRequest,
  callbacks = new Map<string, Map<string, NotificationAction['onClick']>>(),
) {
  const wireActions = (actions: NotificationAction[]) => {
    if (actions.length > 4) {
      throw new Error('通知最多支持 4 个操作按钮');
    }
    return actions.map((action) => ({
      id: crypto.randomUUID(),
      label: action.label,
      type: 'callback',
    }));
  };
  const bind = (id: string, actions: NotificationAction[], wire: { id: string }[]) => {
    callbacks.set(id, new Map(wire.map((action, i) => [action.id, actions[i].onClick])));
  };
  const notification = (id: string): NotificationController => {
    let pending = Promise.resolve();
    const update = (value: NotificationUpdate) => {
      let wire: ReturnType<typeof wireActions> | undefined;
      try {
        wire = value.actions ? wireActions(value.actions) : undefined;
      } catch (error) {
        return Promise.reject(error);
      }
      const run = pending.then(async () => {
        const old = callbacks.get(id);
        if (wire && value.actions) {
          bind(id, value.actions, wire);
        }
        try {
          return await request<NotificationState>(`/notifications/${id}/update`, {
            ...value,
            ...(wire ? { actions: wire } : {}),
          });
        } catch (error) {
          if (wire) {
            if (old) {
              callbacks.set(id, old);
            } else {
              callbacks.delete(id);
            }
          }
          throw error;
        }
      });
      pending = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
    return {
      id,
      update,
      setContent: (title, message) => update({ title, message }),
      setProgress: (progress) => update({ progress }),
      setActions: (actions) => update({ actions }),
      markRead: async (read = true) => {
        await pending;
        return request(`/notifications/${id}/read`, { read });
      },
      getState: async () => {
        await pending;
        return request(`/notifications/${id}`);
      },
      isVisible: async () => {
        await pending;
        return Boolean((await request<NotificationState>(`/notifications/${id}`)).visible);
      },
      close: async () => {
        await pending;
        await request(`/notifications/${id}/close`, {});
        callbacks.delete(id);
      },
    };
  };
  const create = async ({
    title,
    level = 'info',
    ...options
  }: NotificationOptions & { title: string; level?: NotificationLevel }) => {
    const wire = options.actions ? wireActions(options.actions) : undefined;
    const state = await request<NotificationState>('/notifications/publish', {
      level,
      title,
      options: { ...options, ...(wire ? { actions: wire } : {}) },
    });
    if (wire && options.actions) {
      bind(state.id, options.actions, wire);
    }
    return notification(state.id);
  };
  const logger: NotificationLogger = {
    create,
    info: (title, options) => create({ ...options, title, level: 'info' }),
    success: (title, options) => create({ ...options, title, level: 'success' }),
    warn: (title, options) => create({ ...options, title, level: 'warn' }),
    error: (title, options) => create({ ...options, title, level: 'error' }),
  };
  const task = (id: string, managed: boolean): TaskController => {
    let pending = Promise.resolve();
    const getState = async () => {
      await pending;
      return request<TaskState>(`/tasks/${id}`);
    };
    const update = (value: TaskUpdate) => {
      const run = pending.then(() => request<TaskState>(`/tasks/${id}/update`, value));
      pending = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    };
    return {
      id,
      update,
      getState,
      setProgress: (progress) => update({ progress }),
      setContent: (content) => update({ content }),
      succeed: (content) =>
        update({
          status: 'succeeded',
          progress: 100,
          ...(content === undefined ? {} : { content }),
        }),
      fail: (error) => update({ status: 'failed', error, progress: false }),
      cancel: async () => {
        if (managed) {
          return update({ status: 'cancelled', progress: false });
        }
        const current = await getState();
        return request(`/jobs/${id}/cancel`, { baseRevision: current.revision });
      },
    };
  };
  const tasks: TaskManager = {
    create: async (options) => task((await request<TaskState>('/tasks/create', options)).id, true),
    start: async (pluginId, type) =>
      task(
        (
          await request<TaskState>('/tasks/start', {
            pluginId,
            type,
            idempotencyKey: crypto.randomUUID(),
          })
        ).id,
        false,
      ),
  };
  return {
    logger,
    tasks,
    async dispatchAction(value: { id: string; actionId: string }) {
      const action = callbacks.get(value.id)?.get(value.actionId);
      if (!action) {
        throw new Error('通知操作已失效');
      }
      await action();
    },
    dispose() {
      callbacks.clear();
    },
  };
}
