import './scroll-container.ts';
import './context-menu/wb-menu-select.ts';
import './icon.ts';
import { attachTooltip } from '../../../shared/components/tooltip.ts';
import type { WorkbenchScrollContainer } from './scroll-container.ts';
import type { WbMenuSelect } from './context-menu/wb-menu-select.ts';
import type { UIRendererComponents } from './ui-renderer.js';
import { JSONTree } from '../../../shared/components/tree/tree.ts';
import treeStyle from '../../../shared/components/tree/tree.css?raw';
import type { TreeResponse } from '../../../shared/tree.ts';

/** Enhance validated native nodes; plugin models never choose custom element tags. */
export function createJSONComponents(
  options: { scrollPanels?: boolean } = {},
): UIRendererComponents {
  let content: HTMLElement;
  const containers = new Map<HTMLElement, WorkbenchScrollContainer>();
  const selects = new Map<HTMLSelectElement, WbMenuSelect>();
  const feedback = new Map<HTMLElement, { message: HTMLElement; copy: HTMLElement | null }>();
  const cleanups: (() => void)[] = [];
  const trees = new Map<string, JSONTree>();
  const pendingTrees = new Map<
    string,
    {
      resolve(response: TreeResponse): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const disposeTrees = () => {
    for (const tree of trees.values()) {
      tree.dispose();
    }
    trees.clear();
    for (const request of pendingTrees.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('树宿主已释放'));
    }
    pendingTrees.clear();
  };
  const updateFeedback = () => {
    for (const [field, { message, copy }] of feedback) {
      const controlBounds = field.getBoundingClientRect();
      const copyBounds = copy?.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(message).height) || 18;
      // Both columns must share a row. Only use space supplied by the label/description;
      // validation must never create extra vertical room or change the control's centre.
      const below =
        controlBounds.height > 0 &&
        copyBounds &&
        copyBounds.width > 0 &&
        copyBounds.right <= controlBounds.left &&
        controlBounds.top - copyBounds.top >= lineHeight + 4 &&
        copyBounds.bottom - controlBounds.bottom >= lineHeight + 4;
      const placement = below ? 'below' : 'icon';
      if (message.dataset.uiErrorPlacement !== placement) {
        message.dataset.uiErrorPlacement = placement;
      }
    }
  };
  const scrolls = () => {
    let ancestor: Element | null = content;
    let outer: WorkbenchScrollContainer | null = null;
    while (ancestor && !outer) {
      outer = ancestor.closest<WorkbenchScrollContainer>('wb-scroll-container');
      const root = ancestor.getRootNode();
      ancestor = root instanceof ShadowRoot ? root.host : null;
    }
    return [...(outer ? [outer] : []), ...containers.values()];
  };
  const key = (scroll: WorkbenchScrollContainer) => scroll.dataset.uiScroll ?? 'content';
  const update = () => {
    for (const tree of trees.values()) {
      tree.update();
    }
    for (const [node, scroll] of containers) {
      scroll.hidden = node.hidden;
    }
    for (const [node, select] of selects) {
      const options = [...node.options].map((option) => ({
        value: option.value,
        label: option.textContent ?? '',
        disabled: option.disabled,
      }));
      if (JSON.stringify(options) !== JSON.stringify(select.options)) {
        select.options = options;
      }
      select.value = node.value;
      select.disabled = node.disabled;
      select.hidden = node.hidden;
      const labelId = node.getAttribute('aria-labelledby');
      select.label =
        node.getAttribute('aria-label') ||
        (labelId ? content.querySelector(`[id="${CSS.escape(labelId)}"]`)?.textContent : '') ||
        '请选择';
    }
    updateFeedback();
  };
  return {
    mount(element, context) {
      const previous = new Map(
        [...trees.values()].map((tree) => [
          tree.definition.key,
          {
            signature: tree.definition.signature,
            epoch: tree.definition.dataEpoch,
            state: tree.captureState(),
            data: tree.captureData(),
          },
        ]),
      );
      disposeTrees();
      cleanups.splice(0).forEach((dispose) => dispose());
      containers.clear();
      selects.clear();
      feedback.clear();
      content = element;
      if (context?.compiled.trees?.length) {
        const style = document.createElement('style');
        style.textContent = treeStyle;
        content.prepend(style);
        for (const definition of context.compiled.trees) {
          const host = [...content.querySelectorAll<HTMLElement>('[data-scwc-node]')].find(
            (node) => node.dataset.scwcNode === definition.hostNodeId,
          );
          if (!host) {
            throw new Error('树 host 不存在');
          }
          const tree = new JSONTree(host, definition, {
            request: (body, requestId) =>
              new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                  pendingTrees.delete(requestId);
                  reject(new Error('树请求超时'));
                }, 11000);
                pendingTrees.set(requestId, { resolve, reject, timer });
                context.request({
                  ...body,
                  instanceId: context.instanceId,
                  renderRevision: context.renderRevision,
                  treeId: definition.treeId,
                  dataEpoch: definition.dataEpoch,
                  requestId,
                });
              }),
            event: (bindingId, event, modifiers) => context.event(bindingId, event, modifiers),
          });
          trees.set(definition.hostNodeId, tree);
          const saved = previous.get(definition.key);
          if (saved?.signature === definition.signature && saved.epoch === definition.dataEpoch) {
            tree.restoreData(saved.data);
            tree.restoreState(saved.state);
          }
        }
      }
      for (const message of content.querySelectorAll<HTMLElement>('.ui-field-error')) {
        const field = message.parentElement;
        if (field) {
          feedback.set(field, {
            message,
            copy: field.closest('.ui-setting')?.querySelector('.ui-setting-copy') ?? null,
          });
        }
        cleanups.push(attachTooltip(message, () => message.textContent ?? ''));
      }
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(updateFeedback);
        observer.observe(content);
        for (const [field, { copy }] of feedback) {
          observer.observe(field);
          if (copy) {
            observer.observe(copy);
          }
        }
        cleanups.push(() => observer.disconnect());
      }
      for (const node of content.querySelectorAll<HTMLElement>(
        options.scrollPanels === false ? '.ui-tab-list' : '.ui-tab-panel,.ui-tab-list',
      )) {
        const scroll = document.createElement('wb-scroll-container');
        const kind = node.classList.contains('ui-tab-list') ? 'tab-list' : 'panel';
        scroll.className = `ui-scroll ui-scroll-${kind}`;
        scroll.dataset.uiScroll = node.getAttribute('data-scwc-node') ?? '';
        if (kind === 'tab-list') {
          scroll.wheelDirection = 'horizontal';
          scroll.thin = true;
        }
        node.replaceWith(scroll);
        scroll.append(node);
        containers.set(node, scroll);
      }
      for (const node of content.querySelectorAll<HTMLElement>('[data-gap]')) {
        const gap = Number(node.getAttribute('data-gap'));
        if (Number.isFinite(gap) && gap >= 0 && gap <= 100) {
          node.style.setProperty('--ui-gap', `${gap}px`);
        }
      }
      for (const node of content.querySelectorAll('select')) {
        if (node.multiple) {
          continue;
        }
        const select = document.createElement('wb-menu-select');
        select.className = 'ui-select';
        for (const name of ['name', 'data-ui-key', 'aria-label']) {
          const value = node.getAttribute(name);
          if (value !== null) {
            select.setAttribute(name, value);
          }
        }
        // Keep the native field as the compiler's binding target and form owner.
        node.classList.add('ui-select-field');
        node.tabIndex = -1;
        node.setAttribute('aria-hidden', 'true');
        node.after(select);
        const change = (event: Event) => {
          const value = (event as CustomEvent<{ value: string }>).detail.value;
          if (
            node.disabled ||
            ![...node.options].some((option) => option.value === value && !option.disabled)
          ) {
            return;
          }
          node.value = value;
          select.value = value;
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        };
        select.addEventListener('wb-menu-change', change);
        const click = (event: MouseEvent) => {
          if (
            node.disabled ||
            event
              .composedPath()
              .some((target) => target instanceof Element && target.localName === 'wb-context-menu')
          ) {
            return;
          }
          node.dispatchEvent(
            new MouseEvent('click', {
              bubbles: true,
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
            }),
          );
        };
        select.addEventListener('click', click, true);
        cleanups.push(() => {
          select.removeEventListener('wb-menu-change', change);
          select.removeEventListener('click', click, true);
        });
        selects.set(node, select);
        for (const label of content.querySelectorAll('label[for]')) {
          if (label.getAttribute('for') === node.id) {
            const focus = () => select.focus();
            label.addEventListener('click', focus);
            cleanups.push(() => label.removeEventListener('click', focus));
          }
        }
      }
      for (const node of content.querySelectorAll('.core-icon')) {
        const icon = document.createElement('wb-icon');
        const name = [...node.classList].find((name) => name !== 'core-icon') ?? 'info';
        icon.setAttribute(
          'name',
          name === 'syncing' ? 'sync' : name === 'pulsing' ? 'circle' : name,
        );
        icon.setAttribute('size', 'sm');
        node.replaceChildren(icon);
      }
      update();
    },
    update,
    fieldAdapter(nodeId) {
      return trees.get(nodeId);
    },
    treePatch(name, patch) {
      [...trees.values()].find((tree) => tree.definition.name === name)?.applyPatch(patch);
    },
    treeResponse(response) {
      const pending = pendingTrees.get(response.requestId);
      if (pending) {
        pendingTrees.delete(response.requestId);
        clearTimeout(pending.timer);
        pending.resolve(response);
      }
    },
    treeEffect(name, command, response) {
      const tree = [...trees.values()].find((tree) => tree.definition.name === name);
      if (tree) {
        void tree.applyEffect(command, response);
      }
    },
    focusTarget(node) {
      const select = selects.get(node as HTMLSelectElement);
      return select ?? node;
    },
    captureScroll() {
      return new Map(
        scrolls().map((scroll) => [
          key(scroll),
          {
            left: scroll.scrollElement?.scrollLeft ?? 0,
            top: scroll.scrollElement?.scrollTop ?? 0,
          },
        ]),
      );
    },
    restoreScroll(saved) {
      for (const scroll of scrolls()) {
        const position = saved?.get(key(scroll));
        void scroll.updateComplete.then(() => {
          if (scroll.isConnected) {
            scroll.refresh();
            if (position) {
              scroll.scrollTo({ ...position, behavior: 'instant' });
            }
          }
        });
      }
    },
    measureHeight() {
      if (!content) {
        return 0;
      }
      const overflow = Math.max(
        0,
        ...scrolls()
          .filter((scroll) => !scroll.hidden && !scroll.closest('[hidden]'))
          .map((scroll) => {
            const viewport = scroll.scrollElement;
            return viewport ? viewport.scrollHeight - viewport.clientHeight : 0;
          }),
      );
      return content.getBoundingClientRect().height + overflow;
    },
    dispose() {
      disposeTrees();
      cleanups.splice(0).forEach((dispose) => dispose());
      containers.clear();
      selects.clear();
      feedback.clear();
    },
  };
}
