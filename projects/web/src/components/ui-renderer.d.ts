export interface UIRendererMessage {
  method: string;
  payload: unknown;
  renderRevision: number;
}
export function createUIRenderer(
  root: Document | ShadowRoot,
  emit: (message: UIRendererMessage) => void,
): { receive(event: { data: UIRendererMessage }): void; dispose(): void };
