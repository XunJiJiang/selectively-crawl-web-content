export interface UIRendererMessage {
  method: string;
  payload: unknown;
  renderRevision: number;
}
export interface UIRendererComponents {
  mount(
    content: HTMLElement,
    context?: {
      compiled: import('../../../shared/declarative-ui.ts').CompiledUI;
      instanceId: string;
      renderRevision: number;
      request(payload: import('../../../shared/tree.ts').TreeRequest): void;
      event(
        bindingId: string,
        tree: import('../../../shared/tree.ts').TreeWireEvent,
        modifiers?: import('../../../shared/declarative-ui.ts').NormalizedUIEvent['modifiers'],
      ): void;
    },
  ): void;
  fieldAdapter?(nodeId: string): import('../../../shared/tree.ts').TreeFieldAdapter | undefined;
  treeResponse?(response: import('../../../shared/tree.ts').TreeResponse): void;
  treeEffect?(
    name: string,
    command: import('../../../shared/tree.ts').TreeCommand,
    response?: import('../../../shared/tree.ts').TreeResponse,
  ): void;
  treePatch?(name: string, patch: import('../../../shared/tree.ts').TreePatch): void;
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
