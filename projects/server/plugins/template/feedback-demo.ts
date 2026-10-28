/**
 * 前后端共用的最小接入示例。只接收公开工厂，不导入核心运行时代码。
 * 后端传入 onLoad 的 context.workbench，页面传入 window.scwcutils。
 * 通知回调留在创建对象的进程/文档内，由核心转发按钮 ID。
 */
export const feedbackActions = [
  'task.create',
  'task.run',
  'task.progress',
  'task.content',
  'task.succeed',
  'task.fail',
  'task.cancel',
  'notice.create',
  'notice.content',
  'notice.loading',
  'notice.progress',
  'notice.hide',
  'notice.actions',
  'notice.read',
  'notice.unread',
  'notice.close',
  'inspect',
] as const;
export type FeedbackAction = (typeof feedbackActions)[number];
export interface FeedbackSnapshot {
  task: Awaited<ReturnType<SCWC.TaskController['getState']>> | null;
  notification: Awaited<ReturnType<SCWC.NotificationController['getState']>> | null;
  visible: boolean | null;
}

export class FeedbackDemo {
  private factories: SCWC.ILoadContext['workbench'];
  private task?: SCWC.TaskController;
  private notice?: SCWC.NotificationController;
  private source: string;
  private record: (message: string) => void;

  constructor(
    factories: SCWC.ILoadContext['workbench'],
    source: string,
    record: (message: string) => void,
  ) {
    this.factories = factories;
    this.source = source;
    this.record = record;
  }

  async run(action: FeedbackAction): Promise<FeedbackSnapshot> {
    if (action === 'task.create') {
      if (
        this.task &&
        ['queued', 'running', 'cancelling'].includes((await this.task.getState()).status)
      ) {
        throw new Error('请先完成或取消当前任务');
      }
      // 自定义任务可以手动更新；内置 build-ui 等任务由核心驱动，不能伪造其状态。
      this.task = await this.factories.tasks.create({
        title: `${this.source} · 模板验证任务`,
        type: 'template-validation',
        status: 'queued',
        phase: '等待开始',
        content: '点击「开始」和「进度 50%」更新此任务。',
        progress: null,
      });
    } else if (action.startsWith('task.')) {
      if (!this.task) throw new Error('请先创建任务');
      if (action === 'task.run')
        await this.task.update({
          status: 'running',
          phase: '执行中',
          log: { text: '插件开始执行' },
        });
      if (action === 'task.progress') await this.task.setProgress(50);
      if (action === 'task.content')
        await this.task.update({
          content: '插件已更新任务内容',
          phase: '校验中',
          log: { level: 'info', text: '已更新内容与阶段' },
        });
      if (action === 'task.succeed') await this.task.succeed('验证成功，请观察任务按钮的未读状态');
      if (action === 'task.fail') await this.task.fail('模板主动模拟失败');
      if (action === 'task.cancel') await this.task.cancel();
    } else if (action === 'notice.create') {
      if (this.notice) throw new Error('请先关闭当前通知');
      this.notice = await this.factories.logger.create({
        title: `${this.source} · 模板通知`,
        level: 'info',
        message: '打开通知栏检查可见状态；可见不会自动设为已读。',
        progress: null,
        autoRead: false,
        actions: this.actions(false),
      });
    } else if (action.startsWith('notice.')) {
      if (!this.notice) throw new Error('请先创建通知');
      if (action === 'notice.content')
        await this.notice.update({
          title: `${this.source} · 内容已更新`,
          message: '标题、正文和级别由同一控制对象更新。',
          level: 'success',
        });
      if (action === 'notice.loading') await this.notice.setProgress(null);
      if (action === 'notice.progress') await this.notice.setProgress(50);
      if (action === 'notice.hide') await this.notice.setProgress(false);
      if (action === 'notice.actions') await this.notice.setActions(this.actions(true));
      if (action === 'notice.read') await this.notice.markRead();
      if (action === 'notice.unread') await this.notice.markRead(false);
      if (action === 'notice.close') {
        await this.notice.close();
        this.notice = undefined;
      }
    }
    this.record(action);
    return this.snapshot();
  }

  private actions(replaced: boolean) {
    const prefix = replaced ? '新 · ' : '';
    return [
      { label: `${prefix}进度 50%`, onClick: () => this.run('notice.progress') },
      { label: `${prefix}更新内容`, onClick: () => this.run('notice.content') },
      { label: `${prefix}标为已读`, onClick: () => this.run('notice.read') },
      { label: `${prefix}关闭通知`, onClick: () => this.run('notice.close') },
    ];
  }

  async snapshot(): Promise<FeedbackSnapshot> {
    // isVisible 只代表进入通知中心视口，不代表浮层可见，也不代表已读。
    return {
      task: this.task ? await this.task.getState() : null,
      notification: this.notice ? await this.notice.getState() : null,
      visible: this.notice ? await this.notice.isVisible() : null,
    };
  }

  async dispose() {
    if (
      this.task &&
      ['queued', 'running', 'cancelling'].includes((await this.task.getState()).status)
    )
      await this.task.cancel();
    await this.notice?.close();
    this.notice = undefined;
  }
}
