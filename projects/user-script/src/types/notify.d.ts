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
  // beforePreparation: 刚添加到列表中, 尚未渲染到页面上, 需要隐式渲染计算高度
  // preparation: 正在隐式渲染计算高度
  // beforeEnter: 已经渲染到页面上, 但尚未开始进入动画
  // enter: 执行进入动画中或者已经完成进入动画, 此阶段内不重渲染
  // beforeLeave: 开始离开动画, 但尚未开始离开动画
  // leave: 正在离开动画中
  // removed: 已经离开动画完成, 可以从列表中删除
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
