import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFeedbackClient,
  type FeedbackOwner,
  type FeedbackRequest,
} from '../../shared/workbench-feedback.ts';
import { WorkbenchStorage } from './storage.ts';
import { requireValue } from '../../shared/workbench-protocol.ts';
import { NotificationService } from './notifications.ts';
import { OperationService } from './operations.ts';
import { feedbackRequest } from './feedback.ts';
import * as runtime from './runtime.ts';

let storage: WorkbenchStorage;
afterEach(() => {
  vi.restoreAllMocks();
  storage?.close();
});
function fixture(
  owner: FeedbackOwner = { source: 'plugin', pluginId: 'alpha', ownerId: 'host-one' },
) {
  storage = new WorkbenchStorage(':memory:', ':memory:');
  const notifications = new NotificationService(storage),
    operations = new OperationService(storage);
  vi.spyOn(runtime, 'getWorkbench').mockReturnValue({
    notifications,
    operations,
  } as runtime.WorkbenchRuntime);
  const client = createFeedbackClient((async (path, body) =>
    feedbackRequest(owner, path, body, (id, actionId) =>
      client.dispatchAction({ id, actionId }),
    )) as FeedbackRequest);
  return { notifications, operations, client, owner };
}

describe('task and notification control objects', () => {
  it('persists and validates opt-in system notifications across create, update and dedupe', async () => {
    const { client, notifications } = fixture();
    const regular = await client.logger.info('普通通知');
    expect((await regular.getState()).systemNotification).toBe(false);
    const notice = await client.logger.success('完成', {
      dedupeKey: 'import',
      systemNotification: true,
    });
    expect(await notice.getState()).toMatchObject({ systemNotification: true, count: 1 });
    await notice.markRead();
    await notice.update({ systemNotification: false });
    expect((await notice.getState()).readAt).toBeTruthy();
    expect(notifications.list().find((n) => n.id === notice.id)?.systemNotification).toBe(false);
    await expect(notice.update({ systemNotification: 'yes' } as never)).rejects.toThrow();
    const repeated = await client.logger.success('再次完成', {
      dedupeKey: 'import',
      systemNotification: true,
    });
    expect(repeated.id).toBe(notice.id);
    expect(await repeated.getState()).toMatchObject({
      systemNotification: true,
      count: 2,
      readAt: null,
    });
  });
  it('updates loading, content and four function actions without serializing callbacks', async () => {
    const { client, notifications } = fixture();
    const called = vi.fn();
    const notice = await client.logger.info('准备', {
      progress: null,
      autoRead: false,
      actions: Array.from({ length: 4 }, (_, i) => ({ label: `操作${i}`, onClick: called })),
    });
    expect(await notice.getState()).toMatchObject({ title: '准备', progress: null, readAt: null });
    await Promise.all([
      notice.setContent('处理中', '内容'),
      notice.setProgress(0),
      notice.setProgress(55),
    ]);
    const state = await notice.getState();
    expect(state).toMatchObject({ title: '处理中', message: '内容', progress: 55 });
    expect(state.actions).toHaveLength(4);
    expect(JSON.stringify(state)).not.toContain('onClick');
    await notifications.invoke(notice.id, requireValue(state.actions[0].id));
    expect(called).toHaveBeenCalledOnce();
    await expect(
      notice.setActions(Array.from({ length: 5 }, () => ({ label: '过多', onClick: called }))),
    ).rejects.toThrow('4');
    const newer = vi.fn();
    await notice.setActions([{ label: '新的操作', onClick: newer }]);
    await expect(
      notifications.invoke(notice.id, requireValue(state.actions[0].id)),
    ).rejects.toThrow('失效');
    await notifications.invoke(notice.id, requireValue((await notice.getState()).actions[0].id));
    expect(newer).toHaveBeenCalledOnce();
    await expect(notice.setProgress(101)).rejects.toThrow();
    await notice.setProgress(100);
    expect((await notice.getState()).progress).toBe(100);
    await notice.close();
    await expect(notice.getState()).rejects.toThrow('不存在');
  });
  it('reports notification-center visibility separately from explicit read state', async () => {
    const { client, notifications } = fixture();
    const notice = await client.logger.create({ title: '手动已读', autoRead: false });
    expect(await notice.isVisible()).toBe(false);
    notifications.visibility('window-one', [notice.id]);
    notifications.visibility('window-two', [notice.id]);
    expect(await notice.getState()).toMatchObject({ visible: true, readAt: null });
    expect((await notice.getState()).seenAt).toBeTruthy();
    notifications.visibility('window-one', []);
    expect(await notice.isVisible()).toBe(true);
    notifications.visibility('window-two', []);
    expect(await notice.isVisible()).toBe(false);
    await notice.markRead();
    expect((await notice.getState()).readAt).toBeTruthy();
    await notice.markRead(false);
    expect((await notice.getState()).readAt).toBeNull();
  });
  it('enforces plugin and document ownership for notifications and tasks', async () => {
    const { client, owner, notifications, operations } = fixture({
      source: 'page',
      pluginId: 'alpha',
      tabId: 'tab',
      ownerId: 'document-one',
    });
    const notice = await client.logger.info('私有控制器');
    const task = await client.tasks.create({ title: '导入', type: 'build-ui' });
    const other = { ...owner, ownerId: 'document-two' };
    expect(() => notifications.update(notice.id, { title: '越权' }, other)).toThrow('不属于');
    expect(() =>
      operations.update(task.id, { status: 'succeeded' }, { ...owner, pluginId: 'beta' }),
    ).toThrow('不属于');
    await expect(feedbackRequest(other, `/notifications/${notice.id}/close`, {})).rejects.toThrow(
      '不属于',
    );
    await expect(
      feedbackRequest(owner, '/tasks/start', { pluginId: 'beta', type: 'build-ui' }),
    ).rejects.toThrow('当前插件');
  });
  it('tracks custom task content, logs, progress, completion and unread state', async () => {
    const { client, operations } = fixture();
    const task = await client.tasks.create({ title: '导入文件', type: 'import', progress: null });
    await task.update({ content: '已读取文件', phase: '解析', log: { text: '文件 A' } });
    await task.setProgress(40);
    expect(await task.getState()).toMatchObject({
      status: 'running',
      progress: 40,
      content: '已读取文件',
      logs: [{ seq: 1, text: '文件 A' }],
    });
    await task.succeed('完成');
    expect(await task.getState()).toMatchObject({
      status: 'succeeded',
      progress: 100,
      readAt: null,
      content: '完成',
    });
    operations.acknowledge([task.id]);
    expect((await task.getState()).readAt).toBeTruthy();
    await expect(task.update({ status: 'running' })).rejects.toThrow('不能重新运行');
    const orphan = await client.tasks.create({ title: '宿主退出' });
    operations.releaseOwner('host-one');
    expect(await orphan.getState()).toMatchObject({
      status: 'failed',
      progress: false,
      readAt: null,
    });
  });
});
