import { expect, it } from 'vitest';
import { layoutNotificationStack, stackContentHeight, stackWindow } from './notification-stack.ts';

it('keeps variable-height cards at their original size and linear spacing inside the fixed window', () => {
  const heights = [44, 72, 54];
  const cards = layoutNotificationStack(heights, 0, true, 468);
  expect(cards.every((card) => card.scale === 1)).toBe(true);
  expect(cards[1].y - cards[0].y).toBe(44 + stackWindow.gap);
  expect(cards[2].y - cards[1].y).toBe(72 + stackWindow.gap);
  expect(cards[2].y + heights[2]).toBe(468);
});
it('bounds position and scale even for ten thousand cards, with visible cards above every folded card', () => {
  const heights = Array.from({ length: 10000 }, () => 56);
  const cards = layoutNotificationStack(heights, 320000, true, 468);
  expect(
    cards.every(
      (card) =>
        Number.isFinite(card.y) &&
        card.y > -100 &&
        card.y < 500 &&
        card.scale >= stackWindow.minimumScale &&
        card.scale <= 1,
    ),
  ).toBe(true);
  const visible = cards.filter((card) => card.edge === 'visible');
  const folded = cards.filter((card) => card.edge !== 'visible');
  expect(Math.min(...visible.map((card) => card.zIndex))).toBeGreaterThan(
    Math.max(...folded.map((card) => card.zIndex)),
  );
  const above = cards.filter((card) => card.edge === 'above');
  expect(above[above.length - 1].zIndex).toBeGreaterThan(above[0].zIndex);
  const below = cards.filter((card) => card.edge === 'below');
  expect(below[0].zIndex).toBeGreaterThan(below[below.length - 1].zIndex);
});
it('collapses only the upper area while keeping the bottom pile and scroll range unchanged', () => {
  const heights = [56, 88, 44, 72, 56, 96, 56, 44, 88, 56];
  const total = stackContentHeight(heights);
  const expanded = layoutNotificationStack(heights, 110, true, 468);
  const collapsed = layoutNotificationStack(heights, 110, false, 468);
  expanded.forEach((card, index) => {
    if (card.edge === 'below') {
      expect(collapsed[index].y).toBe(card.y);
      expect(collapsed[index].scale).toBe(card.scale);
    }
  });
  expect(collapsed.filter((card) => card.edge === 'above').length).toBeGreaterThan(
    expanded.filter((card) => card.edge === 'above').length,
  );
  expect(stackContentHeight(heights)).toBe(total);
});
it('interpolates the actual available height without ending the animation early in a short popup', () => {
  const heights = Array(12).fill(56);
  const visible = (progress: number) =>
    layoutNotificationStack(heights, 64, true, 300, progress).filter(
      (card) => card.edge === 'visible',
    ).length;
  expect(visible(0)).toBe(1);
  expect(visible(0.5)).toBe(2);
  expect(visible(1)).toBe(3);
});
