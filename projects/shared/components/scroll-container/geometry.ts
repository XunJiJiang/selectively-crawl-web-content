import type { ScrollbarOptions } from './types.ts';

export const defaultScrollbar = {
  size: 6,
  color: 'currentColor',
  radius: 3,
  opacity: 0.5,
  fadeInDuration: 80,
  fadeOutDuration: 400,
  hideDelay: 600,
  minThumbSize: 20,
  placement: 'overlay',
} satisfies Required<ScrollbarOptions>;

export function nonNegative (value: number | undefined, fallback = 0): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function clamp (value: number, max: number): number {
  return Math.min(nonNegative(max), nonNegative(value));
}

export function scrollbarOptions (options: ScrollbarOptions): Required<ScrollbarOptions> {
  return {
    size: nonNegative(options.size, defaultScrollbar.size),
    color: options.color ?? defaultScrollbar.color,
    radius: nonNegative(options.radius, defaultScrollbar.radius),
    opacity: clamp(options.opacity ?? defaultScrollbar.opacity, 1),
    fadeInDuration: nonNegative(options.fadeInDuration, defaultScrollbar.fadeInDuration),
    fadeOutDuration: nonNegative(options.fadeOutDuration, defaultScrollbar.fadeOutDuration),
    hideDelay: nonNegative(options.hideDelay, defaultScrollbar.hideDelay),
    minThumbSize: nonNegative(options.minThumbSize, defaultScrollbar.minThumbSize),
    placement: options.placement ?? defaultScrollbar.placement,
  };
}

export function thumbGeometry (
  viewport: number,
  content: number,
  position: number,
  track: number,
  minimum: number,
) {
  const maxScroll = Math.max(0, content - viewport);
  const visible = viewport > 0 && track > 0 && maxScroll > 0;
  const size = visible ? Math.min(track, Math.max(minimum, (viewport / content) * track)) : 0;
  const travel = Math.max(0, track - size);
  const offset = maxScroll > 0 ? (clamp(position, maxScroll) / maxScroll) * travel : 0;
  return { visible, size, offset, travel, maxScroll };
}
