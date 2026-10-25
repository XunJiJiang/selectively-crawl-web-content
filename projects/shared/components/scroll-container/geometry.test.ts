import { describe, expect, it } from 'vitest';
import { scrollbarOptions, thumbGeometry } from './geometry.ts';

describe('scrollbar geometry', () => {
  it('maps the full content range to the available track travel', () => {
    expect(thumbGeometry(200, 1000, 400, 200, 20)).toEqual({
      visible: true,
      size: 40,
      offset: 80,
      travel: 160,
      maxScroll: 800,
    });
    expect(thumbGeometry(200, 1000, 9999, 200, 20).offset).toBe(160);
    expect(thumbGeometry(200, 1000, -10, 200, 20).offset).toBe(0);
  });

  it('handles empty, hidden and fitting content without NaN or phantom bars', () => {
    for (const [viewport, content, track] of [
      [0, 0, 0],
      [0, 100, 0],
      [200, 200, 200],
      [200, 100, 200],
    ]) {
      const result = thumbGeometry(viewport, content, 0, track, 20);
      expect(result.visible).toBe(false);
      expect(Number.isFinite(result.offset)).toBe(true);
    }
  });

  it('keeps minimum thumbs inside even very small tracks', () => {
    expect(thumbGeometry(200, 100000, 0, 100, 20).size).toBe(20);
    expect(thumbGeometry(200, 100000, 0, 10, 20)).toMatchObject({ size: 10, travel: 0 });
  });

  it('normalizes invalid numeric options and retains independent timing defaults', () => {
    expect(
      scrollbarOptions({ size: NaN, opacity: 3, radius: -2, hideDelay: Infinity }),
    ).toMatchObject({
      size: 4,
      opacity: 1,
      radius: 0,
      hideDelay: 600,
      fadeInDuration: 80,
      fadeOutDuration: 400,
    });
  });
});
