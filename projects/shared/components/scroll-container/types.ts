export type ScrollAxis = 'horizontal' | 'vertical';
export type WheelDirection = 'auto' | ScrollAxis | 'none';
export type ScrollMode = 'smooth' | 'instant';

export interface SmoothWheelOptions {
  /** 总时长下限、上限和首次滚轮的预计间隔，单位 ms。 */
  minDuration?: number;
  maxDuration?: number;
  initialInterval?: number;
  /** 加减速各自占总时长的比例；总和过大时按比例收缩，保留匀速段。 */
  accelerationRatio?: number;
  decelerationRatio?: number;
  /** 加减速时间下限，单位 ms。 */
  minAcceleration?: number;
  minDeceleration?: number;
}

export interface ScrollbarOptions {
  /** 滑块及轨道厚度，单位 px。 */
  size?: number;
  color?: string;
  radius?: number;
  opacity?: number;
  fadeInDuration?: number;
  fadeOutDuration?: number;
  hideDelay?: number;
  minThumbSize?: number;
  /** overlay 不占用内容尺寸；gutter 仅在该轴溢出时预留空间。 */
  placement?: 'overlay' | 'gutter';
}

/** 逻辑内容尺寸及滚动位置（px），用于虚拟列表；省略的字段继续测量 DOM。 */
export interface ScrollMetrics {
  scrollWidth?: number;
  scrollHeight?: number;
  scrollLeft?: number;
  scrollTop?: number;
}

export interface ScrollState extends Required<ScrollMetrics> {
  clientWidth: number;
  clientHeight: number;
  maxScrollLeft: number;
  maxScrollTop: number;
}

export type UpdateScrollMetrics = (metrics: ScrollMetrics) => void;
/** 外部 metrics 存在时 update 为 undefined；此前保存的 update 也会被忽略。 */
export type ScrollContent = (update: UpdateScrollMetrics | undefined) => unknown;

export interface SCWCScrollContainerEventMap {
  scroll: CustomEvent<Readonly<ScrollState>>;
}
