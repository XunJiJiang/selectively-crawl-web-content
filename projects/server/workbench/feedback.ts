import { randomUUID } from 'node:crypto';
import {
  createFeedbackClient,
  type FeedbackOwner,
  type FeedbackRequest,
} from '../../shared/workbench-feedback.ts';
import { getWorkbench } from './runtime.ts';
import { assert } from './storage.ts';

/** Shared REST/IPC dispatcher. The owner always comes from the authenticated transport. */
export async function feedbackRequest(
  owner: FeedbackOwner,
  path: string,
  input: unknown,
  onAction?: (id: string, actionId: string) => void | Promise<void>,
) {
  const { notifications, operations } = getWorkbench();
  const body = (input ?? {}) as Record<string, unknown>;
  if (path === '/notifications/publish') {
    const value = notifications.publish(
      owner.source,
      owner.pluginId,
      body.level as string,
      body.title as string,
      body.options,
      { tabId: owner.tabId, ownerId: owner.ownerId, executionId: owner.executionId },
    );
    if (onAction) {
      notifications.bindAction(value.id, (actionId) => onAction(value.id, actionId));
    }
    return value;
  }
  const notification = path.match(/^\/notifications\/([^/]+)(?:\/(update|read|close))?$/);
  if (notification) {
    const [, id, action] = notification;
    notifications.get(id, owner);
    if (action === 'update') {
      return notifications.update(id, body, owner);
    }
    if (action === 'read') {
      return notifications.read(id, body.read as boolean, owner);
    }
    if (action === 'close') {
      notifications.change([id], true);
      return;
    }
    return notifications.get(id, owner);
  }
  if (path === '/tasks/create') {
    return operations.create(input, owner);
  }
  if (path === '/tasks/start') {
    assert(
      owner.source === 'core' || (body.pluginId === owner.pluginId && body.type !== 'rescan'),
      'task_owner',
      '只能执行当前插件的任务',
      403,
    );
    return operations.start(body.pluginId as string, body.type as string, randomUUID());
  }
  const task = path.match(/^\/(tasks|jobs)\/([^/]+)(?:\/(update|cancel))?$/);
  if (task) {
    const [, , id, action] = task;
    const job = operations.get(id);
    if (job.owner) {
      operations.owned(id, owner);
    } else {
      assert(
        owner.source === 'core' || job.pluginId === owner.pluginId,
        'task_owner',
        '任务不属于当前插件',
        403,
      );
    }
    if (action === 'update') {
      return operations.update(id, body, owner);
    }
    if (action === 'cancel') {
      return operations.cancel(id, body.baseRevision as number);
    }
    return job;
  }
  throw new Error('未知任务或通知操作');
}

/** Core callers can hold this object for the lifetime of their feature. */
export function createBackendFeedback(owner: FeedbackOwner = { source: 'core', pluginId: null }) {
  const client = createFeedbackClient((async (path, body) =>
    feedbackRequest(owner, path, body, (id, actionId) =>
      client.dispatchAction({ id, actionId }),
    )) as FeedbackRequest);
  return client;
}
