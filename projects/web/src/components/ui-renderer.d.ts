export interface UIRendererMessage {
  method: string;
  payload: unknown;
  renderRevision: number;
}
export interface UIRendererComponents {
  mount(content: HTMLElement): void;
  update(): void;
  focusTarget(node: HTMLElement): HTMLElement;
  captureScroll(): Map<string, { left: number; top: number }>;
  restoreScroll(saved?: Map<string, { left: number; top: number }>): void;
  measureHeight(): number;
  dispose(): void;
}
export function createUIRenderer(
  root: Document | ShadowRoot,
  emit: (message: UIRendererMessage) => void,
  components?: UIRendererComponents,
): { receive(event: { data: UIRendererMessage }): void; dispose(): void };
