
export interface INotifyOptions {
  title: string;
  description?: string;
  type?: 'info' | 'success' | 'warn' | 'error';
  placement?: 'tl' | 'tr' | 'tc' | 'bl' | 'br' | 'bc';
  duration?: number;
  onclose?: (source: 'auto' | 'user') => void;
  onclick?: () => void;
}

export type TNotify = Required<INotifyOptions> & {
  id: string;
  idx: number;
  timeoutId: number | undefined;
  offset: number;
  height: number;
}