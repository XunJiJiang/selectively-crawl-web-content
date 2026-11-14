import type { FeedbackProgress, NotificationAction } from '../workbench-feedback.ts';
export type NotifyPlacement = 'tl' | 'tr' | 'tc' | 'bl' | 'br' | 'bc';
export interface INotifyOptions {
  title: string;
  description?: string;
  type?: 'info' | 'success' | 'warn' | 'error';
  placement?: NotifyPlacement;
  /** Milliseconds; zero keeps the notification open. */
  duration?: number;
  progress?: FeedbackProgress;
  /** Use the core workbench presentation when hosted there. Defaults to true. */
  useCore?: boolean;
  /** Automatically mark the notification read on focus or in the notification center. */
  autoRead?: boolean;
  actions?: NotificationAction[];
  onclose?: (source: 'auto' | 'user') => void;
  onclick?: () => void;
}
export interface NotifyHandle {
  id: string;
  close(): boolean;
  update(value: Partial<INotifyOptions>): boolean;
  setContent(title: string, description?: string): Promise<NotifyState>;
  setProgress(progress: FeedbackProgress): Promise<NotifyState>;
  setActions(actions: NotificationAction[]): Promise<NotifyState>;
  markRead(read?: boolean): Promise<NotifyState>;
  getState(): Promise<NotifyState>;
  isVisible(): Promise<boolean>;
}
/** Serializable state; callbacks remain in the creating document. */
export interface NotifyState {
  id: string;
  title: string;
  description: string;
  type: NonNullable<INotifyOptions['type']>;
  placement: NotifyPlacement;
  duration: number;
  progress: FeedbackProgress;
  autoRead: boolean;
  readAt: string | null;
  seenAt: string | null;
  updatedAt: string;
  visible: boolean;
  banner: boolean;
  actions: { id: string; label: string }[];
}
export type NotifyInteraction =
  | { type: 'close' | 'click' }
  | { type: 'action'; actionId: string }
  | { type: 'read'; read: boolean }
  | { type: 'visible' | 'focus' | 'hover'; value: boolean };
/** Retained for callers that previously imported the legacy render-state type. */
export type TNotify = Required<INotifyOptions> & {
  id: string;
  idx: number;
  timeoutId: ReturnType<typeof setTimeout> | undefined;
  offset: number;
  height: number;
  state:
    | 'beforePreparation'
    | 'preparation'
    | 'beforeEnter'
    | 'enter'
    | 'beforeLeave'
    | 'leave'
    | 'removed';
  ref: Element | undefined;
};
