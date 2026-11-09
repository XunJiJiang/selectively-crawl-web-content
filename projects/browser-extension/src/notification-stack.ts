// 虚拟滚动视口始终保持同一高度；展开只改变上边界，不改变滚动坐标或下方堆叠。
export const stackWindow = { collapsed: 56, expanded: 288, gap: 8, spread: 18, minimumScale: 0.86 };
export interface StackedCard {
  y: number;
  scale: number;
  zIndex: number;
  edge: 'above' | 'below' | 'visible';
}
export function stackContentHeight(heights: number[]) {
  return Math.max(
    stackWindow.expanded,
    heights.reduce((sum, height) => sum + height, 0) +
      Math.max(0, heights.length - 1) * stackWindow.gap,
  );
}
export function layoutNotificationStack(
  heights: number[],
  scrollTop: number,
  expanded: boolean,
  stageHeight: number,
  expansion = expanded ? 1 : 0,
): StackedCard[] {
  const bottom = scrollTop + stackWindow.expanded;
  const expandedHeight = Math.min(
    stackWindow.expanded,
    Math.max(stackWindow.collapsed, stageHeight - 164),
  );
  const windowHeight =
    stackWindow.collapsed +
    (expandedHeight - stackWindow.collapsed) * Math.max(0, Math.min(1, expansion));
  const top = bottom - windowHeight;
  const total =
    heights.reduce((sum, height) => sum + height, 0) +
    Math.max(0, heights.length - 1) * stackWindow.gap;
  let start = Math.max(0, stackWindow.expanded - total);
  const cards = heights.map((height) => {
    const center = start + height / 2;
    start += height + stackWindow.gap;
    const edge: StackedCard['edge'] =
      center < top ? 'above' : center > bottom ? 'below' : 'visible';
    const distance = edge === 'above' ? top - center : edge === 'below' ? center - bottom : 0;
    // d/(d+k) 在 [0,1) 内：堆叠位移不超过 spread，缩放不低于 minimumScale。
    const compression = distance / (distance + 80);
    const scale = 1 - (1 - stackWindow.minimumScale) * compression;
    const mappedCenter =
      edge === 'above'
        ? top - stackWindow.spread * compression
        : edge === 'below'
          ? bottom + stackWindow.spread * compression
          : center;
    return { center: mappedCenter, height, scale, distance, edge };
  });
  const depths = cards
    .map((card, index) => ({ ...card, index }))
    .filter((card) => card.edge !== 'visible')
    .sort((a, b) => a.distance - b.distance);
  const ranks = new Map(depths.map((card, rank) => [card.index, rank]));
  // 下方堆叠预留自己的真实边缘；此值与上边界无关，收起不挪动下方卡片。
  const belowExtent = Math.max(
    0,
    ...cards
      .filter((card) => card.edge === 'below')
      .map((card) => card.center + (card.height * card.scale) / 2 - bottom),
  );
  return cards.map((card, index) => ({
    y: stageHeight - belowExtent + card.center - bottom - (card.height * card.scale) / 2,
    scale: card.scale,
    zIndex:
      card.edge === 'visible'
        ? heights.length + index + 1
        : heights.length - (ranks.get(index) ?? 0),
    edge: card.edge,
  }));
}
