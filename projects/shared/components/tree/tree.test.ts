import { uiRequired } from '../../declarative-ui.ts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../../../web/src/components/scroll-container.ts';
import { JSONTree } from './tree.ts';
import { compileTree } from '../../tree-compiler.ts';
import { TreeSession } from '../../tree-session.ts';
import type { TreeRequest, TreeResponse, UITreeNode } from '../../tree.ts';
import type { SCWCTooltip } from '../tooltip.ts';

const options = {
  resource: (path: string) => path,
  validateCall() {
    /* Intentionally empty fixture callback. */
  },
};
const active: JSONTree[] = [];
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 220,
    top: 0,
    left: 0,
    right: 400,
    bottom: 220,
    x: 0,
    y: 0,
    toJSON() {
      /* Intentionally empty fixture callback. */
    },
  });
});
afterEach(() => {
  active.splice(0).forEach((tree) => tree.dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function fixture(
  extra: Partial<UITreeNode> = {},
  invoke: (call: unknown, args: unknown[]) => Promise<unknown> = async () => null,
) {
  const definition = compileTree(
    {
      type: 'tree',
      name: 'files',
      label: 'Files',
      selectionMode: 'multiple',
      value: [],
      nodes: [
        {
          id: 'p',
          label: 'Parent',
          children: [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta', disabled: true },
          ],
        },
      ],
      defaultExpandedKeys: ['p'],
      ...extra,
    },
    options,
  );
  const session = new TreeSession(definition, options);
  const host = document.createElement('div');
  document.body.append(host);
  const event = vi.fn();
  const tree = new JSONTree(host, definition, {
    request: (body, requestId) =>
      session.request(
        {
          ...body,
          requestId,
          treeId: definition.treeId,
          dataEpoch: definition.dataEpoch,
          instanceId: 'i',
          renderRevision: 1,
        } as TreeRequest,
        { fields: {}, invoke: invoke as never },
      ),
    event,
  });
  active.push(tree);
  return { tree, host, session, event };
}
it('keeps readonly selection and rejects disabled API selection while allowing readonly expansion', async () => {
  const { tree, host } = fixture({ readonly: true, value: ['a'] });
  uiRequired(host.querySelector<HTMLElement>('[data-tree-id=p]')).click();
  expect(tree.readValue()).toEqual(['a']);
  expect(tree.state.expandedIds.has('p')).toBe(false);
  expect(() => tree.writeValue(['p'])).toThrow('不可写');
  const other = fixture();
  expect(() => other.tree.writeValue(['b'])).toThrow('不允许选择');
  await other.tree.command({ type: 'expandAll' });
});
it('handles every consecutive folder click, including browser multi-click counts', () => {
  const { tree, host, event } = fixture();
  for (const detail of [1, 2, 3, 4]) {
    uiRequired(host.querySelector('[data-tree-id=p]')).dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail }),
    );
    expect(tree.state.expandedIds.has('p')).toBe(detail % 2 === 0);
    expect(
      host.querySelector('[data-tree-id=p] [data-tree-twistie] wb-icon')?.getAttribute('name'),
    ).toBe(detail % 2 === 0 ? 'chevron-down-compact' : 'chevron-right-compact');
  }
  expect(event.mock.calls.filter(([, value]) => value.type === 'click')).toHaveLength(4);
});
it('preserves mouse targets when the list receives or loses native focus', () => {
  const { host } = fixture();
  const row = uiRequired(host.querySelector<HTMLElement>('[data-tree-id=p]'));
  const list = uiRequired(host.querySelector<HTMLElement>('.tree-list'));
  list.focus();
  expect(host.querySelector('[data-tree-id=p]')).toBe(row);
  list.blur();
  expect(host.querySelector('[data-tree-id=p]')).toBe(row);
});
it('keeps double-click expansion opt-in and leaf activation separate from click expansion', () => {
  const { tree, host, event } = fixture({ expandOn: 'doubleClick' });
  for (const type of ['click', 'click', 'dblclick']) {
    uiRequired(host.querySelector('[data-tree-id=p]')).dispatchEvent(
      new MouseEvent(type, { bubbles: true, detail: type === 'click' ? 1 : 2 }),
    );
    expect(tree.state.expandedIds.has('p')).toBe(type !== 'dblclick');
  }
  uiRequired(host.querySelector('[data-tree-id=p]')).dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, detail: 2 }),
  );
  uiRequired(host.querySelector('[data-tree-id=a]')).dispatchEvent(
    new MouseEvent('dblclick', { bubbles: true, detail: 2 }),
  );
  expect(event.mock.calls.filter(([, value]) => value.type === 'activate')).toHaveLength(1);
});
it('moves focus to readonly rows while preserving selection, then releases focus to the next row', () => {
  const { tree, host } = fixture({
    nodes: [
      { id: 'normal', label: 'Normal' },
      { id: 'readonly', label: 'Readonly', readonly: true },
      { id: 'next', label: 'Next' },
    ],
    defaultExpandedKeys: [],
  });
  uiRequired(host.querySelector<HTMLElement>('[data-tree-id=normal]')).click();
  uiRequired(host.querySelector<HTMLElement>('[data-tree-id=readonly]')).click();
  expect(tree.readValue()).toEqual(['normal']);
  expect(tree.state.focusedId).toBe('readonly');
  expect(host.querySelector('[data-tree-id=normal]')?.getAttribute('data-focus')).toBe('false');
  expect(host.querySelector('[data-tree-id=readonly]')?.getAttribute('aria-selected')).toBe(
    'false',
  );
  uiRequired(host.querySelector<HTMLElement>('[data-tree-id=next]')).click();
  expect(tree.readValue()).toEqual(['next']);
  expect(tree.state.focusedId).toBe('next');
});
it('anchors delegated tooltips to the hovered row and updates on row changes', async () => {
  const { tree, host } = fixture();
  const parent = uiRequired(host.querySelector<HTMLElement>('[data-tree-id=p]'));
  const child = uiRequired(host.querySelector<HTMLElement>('[data-tree-id=a]'));
  const bounds = { width: 200, height: 22, left: 80, right: 280, top: 100, bottom: 122 } as DOMRect;
  parent.getBoundingClientRect = () => bounds;
  child.getBoundingClientRect = () => ({ ...bounds, top: 122, bottom: 144 });
  const tooltip = uiRequired(host.querySelector<SCWCTooltip>('.tree-list + scwc-tooltip'));
  parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await tooltip.updateComplete;
  expect(tooltip.hidden).toBe(false);
  expect(tooltip.text).toBe('Parent');
  expect(tooltip.style.top).toBe('128px');
  child.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: parent }));
  await tooltip.updateComplete;
  expect(tooltip.text).toBe('Alpha');
  expect(tooltip.style.top).toBe('150px');
  // Repainting virtual rows invalidates their anchors and closes the old tooltip.
  tree.restoreState(tree.captureState());
  await Promise.resolve();
  expect(tooltip.hidden).toBe(true);
});
it('shows remote hit paths independently and restores the previous expansion and focus', async () => {
  const { tree, host } = fixture(
    { search: { visible: true, debounce: 0, controller: 'search($tree)' } },
    async () => ({
      hits: [
        {
          path: [
            { id: 'remote', label: 'Remote', hasChildren: true },
            { id: 'hit', label: 'Needle' },
          ],
        },
      ],
      nextCursor: null,
      version: 'static:0',
    }),
  );
  tree.state.focusedId = 'a';
  await tree.command({ type: 'filter', query: 'Needle' });
  expect(host.querySelector('[data-tree-id=hit]')).not.toBeNull();
  expect([...tree.state.expandedIds]).toEqual(['p']);
  await tree.command({ type: 'filter', query: '' });
  expect(host.querySelector('[data-tree-id=hit]')).toBeNull();
  expect(tree.state.focusedId).toBe('a');
  expect([...tree.state.expandedIds]).toEqual(['p']);
});
it('bounds DOM for ten thousand loaded nodes and keeps an offscreen focus row', () => {
  const { tree, host } = fixture({ nodes: [], defaultExpandedKeys: [] });
  tree.store.replace(
    null,
    Array.from({ length: 10000 }, (_, index) => ({ id: `id${index}`, label: `Node ${index}` })),
    null,
    true,
  );
  tree.state.focusedId = 'id9999';
  tree.restoreState(tree.captureState());
  expect(host.querySelectorAll('.tree-row').length).toBeLessThan(35);
  expect(host.querySelector('[data-tree-id=id9999]')).not.toBeNull();
  expect(host.querySelectorAll('option')).toHaveLength(0);
});
it('cancels ignored reads on disposal and rejects their late response', async () => {
  let finish!: (response: TreeResponse) => void;
  const definition = compileTree(
    { type: 'tree', name: 't', label: 'T', loadChildren: 'load($tree)' },
    options,
  );
  const host = document.createElement('div');
  document.body.append(host);
  const request = vi.fn(
    (_body, _id) =>
      new Promise<TreeResponse>((resolve) => {
        finish = resolve;
      }),
  );
  const tree = new JSONTree(host, definition, {
    request,
    event() {
      /* Intentionally empty fixture callback. */
    },
  });
  active.push(tree);
  tree.dispose();
  expect(request.mock.calls.some(([body]) => body.kind === 'cancel')).toBe(true);
  finish({
    treeId: definition.treeId,
    dataEpoch: definition.dataEpoch,
    requestId: 'late',
    instanceId: 'i',
    renderRevision: 1,
    sequence: 1,
    kind: 'children',
  });
  expect(tree.store.nodes.size).toBe(0);
});
