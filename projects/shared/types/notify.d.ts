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
  actions?: NotificationAction[];
  onclose?: (source: 'auto' | 'user') => void;
  onclick?: () => void;
}
export interface NotifyHandle {
  id: string;
  close(): boolean;
  update(value: Partial<INotifyOptions>): boolean;
}
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
