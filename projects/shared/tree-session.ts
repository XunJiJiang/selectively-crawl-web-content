import {
  uiRequired,
  UIError,
  UI_LIMITS,
  hasOwn,
  uiAssert,
  uiValue,
  type CallNode,
  type FieldValue,
  type UIEventBinding,
  type UIValue,
} from './declarative-ui.ts';
import { evaluateArgument, walkArgument } from './ui-expressions.ts';
import {
  compileTreeItems,
  compileTreeRow,
  treeBinding,
  type TreeCompileOptions,
} from './tree-compiler.ts';
import { TreeDataStore, emptyList, normalizeTreeMove, treeId, treeValueIds } from './tree-model.ts';
import {
  TREE_LIMITS,
  type CompiledTree,
  type TreeItem,
  type TreeControllerContext,
  type TreeEvent,
  type TreePatch,
  type TreeRequest,
  type TreeResponse,
  type TreeSearchPage,
  type TreeWireEvent,
} from './tree.ts';

export interface TreeExecution {
  fields: Record<string, UIValue>;
  signal?: AbortSignal;
  invoke(call: CallNode, args: UIValue[], signal: AbortSignal): Promise<UIValue | undefined>;
}
/** Shared authority for both authenticated host runners. No browser-supplied programs execute. */
export class TreeSession {
  definition: CompiledTree;
  store: TreeDataStore;
  value: FieldValue;
  disabled = false;
  readonly = false;
  sequence = 0;
  disposed = false;
  checkInstance?: (nodes: number, bytes: number) => void;
  private active = new Map<
    string,
    { controller: AbortController; promise: Promise<TreeResponse>; fingerprint: string }
  >();
  private reads = new Map<string, Promise<TreePatch>>();
  private rows = new Map<string, { revision: number; view: ReturnType<typeof compileTreeRow> }>();
  private projected = new TreeDataStore('search');
  private query = '';
  private queryGeneration = 0;
  private queryCursor: string | null = null;
  private queryCursors = new Set<string>();
  private cursors = new Map<string | null, Set<string>>();
  private operations = new Map<string, { fingerprint: string; promise: Promise<TreeResponse> }>();
  private moving = false;
  private topologyGeneration = 0;
  private savedPendingRefresh = false;
  private compileOptions: TreeCompileOptions;
  constructor(definition: CompiledTree, options: TreeCompileOptions) {
    this.definition = definition;
    this.compileOptions = options;
    this.store = new TreeDataStore(
      definition.dataEpoch,
      definition.nodes ?? (definition.controllers.children ? undefined : []),
    );
    this.store.version = definition.controllers.children ? null : 'static:0';
    this.value =
      typeof definition.options.value === 'string' && definition.options.value.includes('${')
        ? ''
        : (definition.options.value ?? (definition.options.selectionMode === 'multiple' ? [] : ''));
    this.disabled = definition.options.disabled === true;
    this.readonly = definition.options.readonly === true;
  }
  private permissions() {
    return { disabled: this.disabled, readonly: this.readonly };
  }
  private nodeStore(id: string) {
    return this.store.nodes.has(id) ? this.store : this.projected;
  }
  private checkBudget(store = this.store, projected = this.projected, rows = this.rows) {
    const nodes = store.nodes.size + projected.nodes.size;
    const bytes = new TextEncoder().encode(
      JSON.stringify([
        [...store.nodes.values()],
        [...projected.nodes.values()],
        [...rows.values()],
      ]),
    ).length;
    uiAssert(
      nodes <= TREE_LIMITS.nodes && bytes <= TREE_LIMITS.bytes,
      'TREE_QUOTA_EXCEEDED',
      '树缓存达到上限',
    );
    this.checkInstance?.(nodes, bytes);
  }
  private fit(store: TreeDataStore, patch: TreePatch, request: TreeRequest) {
    const protectedIds = new Set([
      ...treeValueIds(this.value, this.definition.options.selectionMode),
      ...(request.viewState?.selectedIds ?? []),
      ...(request.viewState?.expandedIds ?? []),
      ...(request.viewState?.focusedId ? [request.viewState.focusedId] : []),
      ...(patch.upsert ?? [])
        .filter((record) => !this.store.nodes.has(record.item.id))
        .map((record) => record.item.id),
      ...(request.kind === 'children' && request.parentId !== null ? [request.parentId] : []),
    ]);
    const candidates = [...store.children].filter(
      ([parent, list]) => parent !== null && list.complete && list.ids.length,
    );
    for (;;) {
      try {
        this.checkBudget(
          store,
          this.projected,
          new Map(
            [...this.rows].filter(([id]) => store.nodes.has(id) || this.projected.nodes.has(id)),
          ),
        );
        return;
      } catch (error) {
        if (!(error instanceof UIError) || error.code !== 'TREE_QUOTA_EXCEEDED') {
          throw error;
        }
        const index = candidates.findIndex(
          ([parent]) =>
            ![uiRequired(parent), ...store.descendants(uiRequired(parent))].some((id) =>
              protectedIds.has(id),
            ),
        );
        if (index < 0) {
          throw error;
        }
        const [parent] = candidates.splice(index, 1)[0];
        if (!store.nodes.has(uiRequired(parent))) {
          continue;
        }
        const remove = store.descendants(uiRequired(parent)).slice(1);
        const empty = {
          ...emptyList(),
          generation: (store.children.get(uiRequired(parent))?.generation ?? 0) + 1,
        };
        for (const id of remove) {
          store.nodes.delete(id);
          store.children.delete(id);
        }
        const record = { ...uiRequired(store.nodes.get(uiRequired(parent))), childIds: [] };
        store.nodes.set(uiRequired(parent), record);
        store.children.set(uiRequired(parent), empty);
        patch.remove = [...(patch.remove ?? []), ...remove];
        patch.upsert = [
          ...(patch.upsert ?? []).filter(
            (record) => !remove.includes(record.item.id) && record.item.id !== parent,
          ),
          record,
        ];
        patch.lists = [
          ...(patch.lists ?? []).filter(
            ([id]) => id !== parent && !remove.includes(uiRequired(id)),
          ),
          [parent, empty],
        ];
      }
    }
  }
  private bindings(candidate: CompiledTree) {
    const merged = [
      ...new Map(
        [...this.definition.bindings, ...candidate.bindings].map((binding) => [
          binding.id,
          binding,
        ]),
      ).values(),
    ];
    uiAssert(merged.length <= TREE_LIMITS.programs, 'TREE_QUOTA_EXCEEDED', '树事件程序超过上限');
    return merged;
  }
  private pruneBindings() {
    const used = new Set(Object.values(this.definition.defaults));
    for (const store of [this.store, this.projected]) {
      for (const record of store.nodes.values()) {
        for (const id of Object.values(record.item.bindings ?? {})) {
          used.add(id);
        }
      }
    }
    for (const [id, row] of this.rows) {
      if (this.nodeStore(id).nodes.get(id)?.nodeRevision !== row.revision) {
        this.rows.delete(id);
        continue;
      }
      for (const action of row.view.actions ?? []) {
        if (action.bindingId) {
          used.add(action.bindingId);
        }
      }
    }
    this.definition.bindings = this.definition.bindings.filter((binding) => used.has(binding.id));
  }
  validateSelection(value: unknown, write = false): void {
    const ids = treeValueIds(value, this.definition.options.selectionMode);
    const previous = new Set(treeValueIds(this.value, this.definition.options.selectionMode));
    const changed = JSON.stringify(value) !== JSON.stringify(this.value);
    uiAssert(
      !changed || (!this.disabled && !this.readonly),
      'TREE_READ_ONLY',
      '禁用或只读树不能修改选择',
    );
    for (const id of ids) {
      const data = this.nodeStore(id),
        snapshot = data.snapshot(id, this.permissions());
      uiAssert(
        previous.has(id) ||
          (!snapshot.disabled &&
            !snapshot.readonly &&
            uiRequired(data.nodes.get(id)).item.selectable !== false),
        'TREE_READ_ONLY',
        '节点不允许选择',
      );
    }
    for (const id of previous) {
      if (!ids.includes(id) && this.nodeStore(id).nodes.has(id)) {
        const snapshot = this.nodeStore(id).snapshot(id, this.permissions());
        uiAssert(
          !snapshot.disabled && !snapshot.readonly,
          'TREE_READ_ONLY',
          '只读节点的选择不能改变',
        );
      }
    }
    if (write) {
      this.value = structuredClone(value) as FieldValue;
    }
  }
  async prepareSelection(
    value: unknown,
    identity: { instanceId: string; renderRevision: number },
    execution: TreeExecution,
  ) {
    const patches: TreePatch[] = [];
    for (const id of treeValueIds(value, this.definition.options.selectionMode)) {
      if (this.nodeStore(id).nodes.has(id)) {
        continue;
      }
      const response = await this.request(
        {
          ...identity,
          treeId: this.definition.treeId,
          dataEpoch: this.definition.dataEpoch,
          requestId: crypto.randomUUID(),
          kind: 'path',
          nodeId: id,
        },
        execution,
      );
      uiAssert(
        !response.error,
        response.error?.code ?? 'TREE_UNKNOWN_NODE',
        response.error?.message ?? '节点无法解析',
      );
      if (response.patch) {
        patches.push(response.patch);
      }
    }
    this.validateSelection(value);
    return patches;
  }
  event(input: TreeWireEvent, bindingId: string): { binding: UIEventBinding; event: TreeEvent } {
    uiAssert(
      input.treeId === this.definition.treeId &&
        input.dataEpoch === this.definition.dataEpoch &&
        !this.disposed,
      'TREE_STALE_BINDING',
      '树事件版本已过期',
    );
    uiAssert(!this.disabled, 'TREE_DISABLED', '树已禁用');
    uiAssert(
      ['pointer', 'keyboard', 'api', 'retry'].includes(input.reason) &&
        Array.isArray(input.selectedIds),
      'TREE_INVALID_EVENT',
      '树事件参数无效',
    );
    if (input.type === 'filter' && input.query === '') {
      this.query = '';
      this.queryCursor = null;
      this.queryGeneration++;
    }
    const data = input.nodeId === null ? this.store : this.nodeStore(input.nodeId);
    const snapshot = input.nodeId === null ? null : data.snapshot(input.nodeId, this.permissions());
    uiAssert(!snapshot?.disabled, 'TREE_DISABLED', '节点已禁用');
    const item = input.nodeId === null ? undefined : data.nodes.get(input.nodeId)?.item;
    let expected: string | undefined;
    if (input.type === 'action') {
      const row = input.nodeId ? this.rows.get(input.nodeId) : undefined;
      uiAssert(
        row && row.revision === data.nodes.get(uiRequired(input.nodeId))?.nodeRevision,
        'TREE_STALE_BINDING',
        '行操作版本已过期',
      );
      const action = row.view.actions?.find((action) => action.id === input.actionId);
      uiAssert(action && !action.disabled, 'TREE_DISABLED', '行操作不可用');
      expected = action.bindingId;
    } else {
      expected =
        item?.bindings?.[input.type as keyof NonNullable<typeof item.bindings>] ??
        this.definition.defaults[input.type];
    }
    uiAssert(
      expected === bindingId || (expected === undefined && bindingId === '$state'),
      'TREE_STALE_BINDING',
      '事件不属于当前节点',
    );
    const binding =
      bindingId === '$state' && expected === undefined
        ? {
            id: '$state',
            nodeId: this.definition.hostNodeId,
            event: input.type,
            program: { branches: [] },
            for: [],
            capture: this.definition.options.selectionMode === 'none' ? [] : [this.definition.name],
          }
        : treeBinding(this.definition, bindingId);
    if (this.readonly || snapshot?.readonly) {
      for (const branch of binding.program.branches) {
        for (const step of branch) {
          walkArgument(step, (node) => {
            if (node.type === 'call') {
              this.compileOptions.validateCall(node.name, true, false);
            }
          });
        }
      }
    }
    if (input.type === 'change') {
      uiAssert(!this.readonly && !snapshot?.readonly, 'TREE_READ_ONLY', '只读树不能更改选择');
    }
    const value =
      this.definition.options.selectionMode === 'multiple'
        ? input.selectedIds
        : (input.selectedIds[0] ?? '');
    if (this.definition.options.selectionMode !== 'none') {
      this.validateSelection(value, true);
    }
    uiAssert(
      input.focusedId === null || this.nodeStore(input.focusedId).nodes.has(input.focusedId),
      'TREE_UNKNOWN_NODE',
      '焦点节点不存在',
    );
    return {
      binding: { ...binding, event: input.type },
      event: {
        type: input.type,
        name: this.definition.name,
        ...(this.definition.options.selectionMode === 'none' ? {} : { value }),
        tree: {
          nodeId: input.nodeId,
          node: snapshot,
          selectedIds: [...input.selectedIds],
          focusedId: input.focusedId,
          reason: input.reason,
          ...(input.query === undefined ? {} : { query: input.query }),
          ...(input.expanded === undefined ? {} : { expanded: input.expanded }),
          ...(input.actionId === undefined ? {} : { actionId: input.actionId }),
        },
      },
    };
  }
  private async invoke(
    kind: keyof CompiledTree['controllers'],
    context: TreeControllerContext,
    execution: TreeExecution,
    signal: AbortSignal,
  ) {
    const controller = this.definition.controllers[kind];
    uiAssert(controller, 'TREE_UNSUPPORTED', '未声明此树控制器');
    signal.throwIfAborted();
    const evaluation = evaluateArgument(controller, {
      fields: execution.fields,
      tree: context as unknown as UIValue,
      invoke: (call, args) => {
        signal.throwIfAborted();
        return execution.invoke(call, args, signal);
      },
    });
    let cancel!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new UIError('TREE_CANCELLED', '树请求已取消'));
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) {
        cancel();
      }
    });
    let result: UIValue | undefined;
    try {
      result = await Promise.race([evaluation, cancelled]);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
    signal.throwIfAborted();
    uiAssert(!this.disposed, 'TREE_STALE_INSTANCE', '树实例已释放');
    return result;
  }
  private base(request: TreeRequest) {
    return {
      treeName: this.definition.name,
      requestId: request.requestId,
      dataEpoch: request.dataEpoch,
    };
  }
  private valid(request: TreeRequest) {
    uiAssert(
      !this.disposed &&
        request.treeId === this.definition.treeId &&
        request.dataEpoch === this.definition.dataEpoch,
      'TREE_STALE_INSTANCE',
      '树实例版本已变化',
    );
    uiAssert(treeId(request.requestId), 'TREE_INVALID_REQUEST', '树请求标识无效');
    uiValue(request, 262144);
  }
  request(request: TreeRequest, execution: TreeExecution): Promise<TreeResponse> {
    this.valid(request);
    const original = execution;
    let steps = 0;
    execution = {
      ...original,
      invoke: (call, args, signal) => {
        uiAssert(++steps <= UI_LIMITS.steps, 'TREE_QUOTA_EXCEEDED', '树请求调用步骤超过上限');
        return original.invoke(call, args, signal);
      },
    };
    const response = (extra: Partial<TreeResponse> = {}): TreeResponse => ({
      instanceId: request.instanceId,
      renderRevision: request.renderRevision,
      treeId: request.treeId,
      dataEpoch: request.dataEpoch,
      requestId: request.requestId,
      kind: request.kind,
      sequence: ++this.sequence,
      ...extra,
    });
    if (request.kind === 'cancel') {
      this.active.get(request.targetRequestId)?.controller.abort();
      return Promise.resolve(response());
    }
    const fingerprint = JSON.stringify(request);
    const previous = this.active.get(request.requestId);
    if (previous) {
      uiAssert(previous.fingerprint === fingerprint, 'TREE_REQUEST_CONFLICT', '请求标识重复');
      return previous.promise;
    }
    uiAssert(
      this.active.size < TREE_LIMITS.concurrent,
      'TREE_QUOTA_EXCEEDED',
      '树并发读取超过 4 个',
    );
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10000),
      ...(execution.signal ? [execution.signal] : []),
    ]);
    const work = (async () => {
      if (request.kind === 'command' && request.command.type === 'move') {
        const cached = this.operations.get(request.operationId);
        const operationFingerprint = JSON.stringify(request.command);
        if (cached) {
          uiAssert(
            cached.fingerprint === operationFingerprint,
            'TREE_OPERATION_CONFLICT',
            '移动操作标识冲突',
          );
          return {
            ...(await cached.promise),
            instanceId: request.instanceId,
            renderRevision: request.renderRevision,
            requestId: request.requestId,
          };
        }
        uiAssert(this.operations.size < 512, 'TREE_QUOTA_EXCEEDED', '移动回执已达上限，请刷新实例');
        const promise = this.command(request, execution, signal).then(response);
        this.operations.set(request.operationId, { fingerprint: operationFingerprint, promise });
        return promise;
      }
      const result = await this.perform(request, execution, signal);
      signal.throwIfAborted();
      return response(result);
    })()
      .catch((error: unknown) =>
        response({
          error: {
            code:
              error instanceof UIError
                ? error.code
                : signal.aborted
                  ? 'TREE_CANCELLED'
                  : 'TREE_LOAD_FAILED',
            message:
              error instanceof UIError
                ? error.message
                : signal.aborted
                  ? '树请求已取消'
                  : '树控制器执行失败',
            retryable: !this.disposed,
          },
        }),
      )
      .finally(() => {
        this.active.delete(request.requestId);
      });
    this.active.set(request.requestId, { controller, promise: work, fingerprint });
    return work;
  }
  private async perform(
    request: TreeRequest,
    execution: TreeExecution,
    signal: AbortSignal,
  ): Promise<Partial<TreeResponse>> {
    uiAssert(!this.disabled, 'TREE_DISABLED', '树已禁用');
    if (request.kind === 'command') {
      return this.command(request, execution, signal);
    }
    if (request.kind === 'children') {
      const id = request.parentId;
      if (request.refresh && id === null) {
        this.topologyGeneration++;
        for (const task of this.active.values()) {
          task.controller.abort();
        }
      }
      const topology = this.topologyGeneration;
      if (id !== null) {
        uiAssert(
          !this.store.snapshot(id, this.permissions()).disabled,
          'TREE_DISABLED',
          '分支已禁用',
        );
      }
      const list = this.store.children.get(id) ?? emptyList();
      uiAssert(
        Number.isSafeInteger(request.generation) && request.generation >= list.generation,
        'TREE_STALE_GENERATION',
        '分支读取已失效',
      );
      if (
        !this.definition.controllers.children ||
        (!request.refresh && request.cursor === null && list.status === 'loaded')
      ) {
        return { patch: this.branchPatch(id) };
      }
      uiAssert(
        request.cursor === null || request.cursor === list.nextCursor,
        'TREE_INVALID_CURSOR',
        '游标不是当前分支签发值',
      );
      const key = JSON.stringify([id, request.cursor, request.generation]);
      const existing = this.reads.get(key);
      if (existing) {
        return { patch: await existing };
      }
      this.store.children.set(id, { ...list, generation: request.generation });
      const load = (async () => {
        const raw = await this.invoke(
          'children',
          {
            ...this.base(request),
            kind: 'children',
            parent: id === null ? null : this.store.snapshot(id, this.permissions()),
            cursor: request.cursor,
            limit: TREE_LIMITS.page,
            version: this.store.version,
          },
          execution,
          signal,
        );
        uiValue(raw, TREE_LIMITS.pageBytes);
        uiAssert(topology === this.topologyGeneration, 'TREE_STALE_GENERATION', '整树已刷新');
        const page = raw as unknown as {
          items: unknown;
          version: string;
          nextCursor: string | null;
        };
        uiAssert(
          page &&
            typeof page.version === 'string' &&
            page.version.length > 0 &&
            (page.nextCursor === null || treeId(page.nextCursor)),
          'TREE_INVALID_PAGE',
          '子节点页结构无效',
        );
        uiAssert(
          this.store.children.get(id)?.generation === request.generation,
          'TREE_STALE_GENERATION',
          '分支读取已失效',
        );
        if (this.store.version !== null && page.version !== this.store.version) {
          uiAssert(
            request.refresh && id === null && request.cursor === null,
            'TREE_VERSION_CONFLICT',
            '分页版本不一致，请刷新整树',
          );
        }
        const seen =
          request.cursor === null ? new Set<string>() : (this.cursors.get(id) ?? new Set<string>());
        uiAssert(
          page.nextCursor === null ||
            (!seen.has(page.nextCursor) && page.nextCursor !== request.cursor),
          'TREE_INVALID_CURSOR',
          '分页游标重复',
        );
        const candidate = structuredClone(this.definition);
        const items = compileTreeItems(page.items, candidate, this.compileOptions, true);
        const bindings = this.bindings(candidate);
        const changedVersion = this.store.version !== null && this.store.version !== page.version;
        const next = this.store.clone();
        const patch = next.replace(
          id,
          items,
          page.nextCursor,
          page.nextCursor === null,
          request.cursor !== null,
          true,
        );
        this.fit(next, patch, request);
        this.store = next;
        this.definition.bindings = bindings;
        if (changedVersion) {
          this.rows.clear();
          this.projected = new TreeDataStore('search');
          for (const [parent, state] of this.store.children) {
            if (parent !== id && state.ids.length) {
              const invalid = {
                ...state,
                status: 'unloaded' as const,
                complete: false,
                nextCursor: null,
                generation: state.generation + 1,
              };
              this.store.children.set(parent, invalid);
              patch.lists?.push([parent, invalid]);
            }
          }
        }
        this.store.version = page.version;
        patch.version = page.version;
        if (request.refresh && id === null) {
          this.savedPendingRefresh = false;
        }
        if (page.nextCursor) {
          seen.add(page.nextCursor);
        }
        this.cursors.set(id, seen);
        for (const removed of patch.remove ?? []) {
          this.rows.delete(removed);
        }
        const selected = treeValueIds(this.value, this.definition.options.selectionMode).filter(
          (key) => this.store.nodes.has(key) || this.projected.nodes.has(key),
        );
        this.value =
          this.definition.options.selectionMode === 'multiple' ? selected : (selected[0] ?? '');
        this.pruneBindings();
        return patch;
      })().finally(() => {
        this.reads.delete(key);
      });
      this.reads.set(key, load);
      return { patch: await load };
    }
    if (request.kind === 'render') {
      uiAssert(
        Array.isArray(request.nodes) &&
          request.nodes.length <= TREE_LIMITS.render &&
          new Set(request.nodes.map((node) => node.id)).size === request.nodes.length,
        'TREE_QUOTA_EXCEEDED',
        '渲染批次无效',
      );
      const rows: NonNullable<TreeResponse['rows']> = [];
      const candidate = structuredClone(this.definition);
      for (const node of request.nodes) {
        const data = this.nodeStore(node.id),
          record = data.nodes.get(node.id);
        uiAssert(
          record && record.nodeRevision === node.revision,
          'TREE_STALE_NODE',
          '节点渲染版本已变化',
        );
        let row = this.rows.get(node.id);
        if (row?.revision !== node.revision) {
          const raw = await this.invoke(
            'render',
            {
              ...this.base(request),
              kind: 'render',
              node: data.snapshot(node.id, this.permissions()),
            },
            execution,
            signal,
          );
          row = {
            revision: node.revision,
            view: compileTreeRow(raw, candidate, this.compileOptions),
          };
        }
        uiAssert(
          this.nodeStore(node.id).nodes.get(node.id)?.nodeRevision === node.revision,
          'TREE_STALE_NODE',
          '节点渲染版本已变化',
        );
        rows.push({ id: node.id, ...row });
      }
      uiValue(rows, TREE_LIMITS.pageBytes);
      const nextRows = new Map(this.rows);
      for (const row of rows) {
        nextRows.set(row.id, row);
      }
      this.checkBudget(this.store, this.projected, nextRows);
      this.definition.bindings = this.bindings(candidate);
      for (const row of rows) {
        this.rows.set(row.id, row);
      }
      this.pruneBindings();
      return { rows };
    }
    if (request.kind === 'search') {
      uiAssert(
        this.definition.options.search !== false &&
          typeof request.query === 'string' &&
          request.query.length <= 4096 &&
          Number.isSafeInteger(request.queryGeneration) &&
          request.queryGeneration >= this.queryGeneration,
        'TREE_INVALID_QUERY',
        '搜索请求无效',
      );
      if (request.queryGeneration > this.queryGeneration) {
        this.queryGeneration = request.queryGeneration;
        this.query = request.query;
        this.queryCursor = null;
        this.queryCursors.clear();
        // Pin selected search identities across queries, without treating paths as complete lists.
        const pinned = treeValueIds(this.value, this.definition.options.selectionMode);
        const keep = new Set(
          pinned.flatMap((id) =>
            this.projected.nodes.has(id) ? [id, ...this.projected.ancestors(id)] : [],
          ),
        );
        for (const id of [...this.projected.nodes.keys()]) {
          if (!keep.has(id)) {
            this.projected.nodes.delete(id);
            this.projected.children.delete(id);
          }
        }
      }
      uiAssert(
        this.query === request.query && request.cursor === this.queryCursor,
        'TREE_STALE_QUERY',
        '查询或游标已过期',
      );
      const raw = await this.invoke(
        'search',
        {
          ...this.base(request),
          kind: 'search',
          query: request.query,
          cursor: request.cursor,
          limit: TREE_LIMITS.page,
          version: this.store.version,
        },
        execution,
        signal,
      );
      uiValue(raw, TREE_LIMITS.pageBytes);
      const page = raw as unknown as TreeSearchPage;
      uiAssert(
        page &&
          Array.isArray(page.hits) &&
          page.hits.length <= TREE_LIMITS.page &&
          typeof page.version === 'string' &&
          (page.nextCursor === null || treeId(page.nextCursor)),
        'TREE_INVALID_PAGE',
        '搜索页无效',
      );
      uiAssert(
        request.queryGeneration === this.queryGeneration && request.query === this.query,
        'TREE_STALE_QUERY',
        '旧查询结果已丢弃',
      );
      uiAssert(
        this.store.version === null || this.store.version === page.version,
        'TREE_VERSION_CONFLICT',
        '搜索版本不一致，请刷新整树',
      );
      uiAssert(
        page.nextCursor === null ||
          (!this.queryCursors.has(page.nextCursor) && page.nextCursor !== request.cursor),
        'TREE_INVALID_CURSOR',
        '搜索游标重复',
      );
      const candidate = structuredClone(this.definition),
        projected = this.projected.clone();
      const hits = page.hits.map((hit) => {
        const path = this.compilePath(hit.path, candidate);
        this.installPath(projected, path);
        if (hit.matchRanges) {
          uiAssert(
            hit.matchRanges.every(
              (range) =>
                Array.isArray(range) &&
                range.length === 2 &&
                range.every(Number.isSafeInteger) &&
                range[0] >= 0 &&
                range[1] > range[0] &&
                range[1] <= uiRequired(path[path.length - 1]).label.length,
            ),
            'TREE_INVALID_PAGE',
            '高亮范围无效',
          );
        }
        return { ...hit, path };
      });
      projected.checkQuota();
      this.checkBudget(this.store, projected);
      this.projected = projected;
      this.definition.bindings = this.bindings(candidate);
      this.pruneBindings();
      this.queryCursor = page.nextCursor;
      if (page.nextCursor) {
        this.queryCursors.add(page.nextCursor);
      }
      return { page: { ...page, hits } };
    }
    if (request.kind === 'path') {
      uiAssert(treeId(request.nodeId), 'TREE_UNKNOWN_NODE', '节点 ID 无效');
      if (this.store.nodes.has(request.nodeId)) {
        const path = [...this.store.ancestors(request.nodeId).reverse(), request.nodeId].map(
          (id) => uiRequired(this.store.nodes.get(id)).item,
        );
        return { path: { path, version: this.store.version ?? '' } };
      }
      const raw = await this.invoke(
        'path',
        { ...this.base(request), kind: 'resolvePath', nodeId: request.nodeId },
        execution,
        signal,
      );
      uiValue(raw, TREE_LIMITS.pageBytes);
      const result = raw as unknown as { path: TreeItem[]; version: string };
      uiAssert(
        result &&
          typeof result.version === 'string' &&
          result.path?.[result.path.length - 1]?.id === request.nodeId &&
          (this.store.version === null || this.store.version === result.version),
        'TREE_INVALID_PATH',
        '节点路径或版本无效',
      );
      const candidate = structuredClone(this.definition),
        path = this.compilePath(result.path, candidate),
        next = this.store.clone();
      this.installPath(next, path);
      next.checkQuota();
      this.checkBudget(next);
      this.store = next;
      this.definition.bindings = this.bindings(candidate);
      this.pruneBindings();
      this.store.version = result.version;
      return {
        path: { path, version: result.version },
        patch: {
          upsert: path.map((item) => uiRequired(this.store.nodes.get(item.id))),
          lists: [null, ...path.map((item) => item.id)].map((id) => [
            id,
            uiRequired(this.store.children.get(id)),
          ]),
          version: result.version,
        },
      };
    }
    return {};
  }
  private compilePath(raw: unknown, candidate: CompiledTree) {
    uiAssert(
      Array.isArray(raw) &&
        raw.length > 0 &&
        raw.length <= TREE_LIMITS.depth &&
        raw.every((item) => item && typeof item === 'object' && !hasOwn(item, 'children')),
      'TREE_INVALID_PATH',
      '路径必须为无 children 的祖先链',
    );
    const path = compileTreeItems(raw, candidate, this.compileOptions, true);
    let parent: string | null = null;
    for (const item of path) {
      const existing = this.store.nodes.get(item.id);
      uiAssert(
        !existing || existing.parentId === parent,
        'TREE_INVALID_PARENT',
        '路径与已知节点父级冲突',
      );
      parent = item.id;
    }
    return path;
  }
  private installPath(store: TreeDataStore, path: TreeItem[]) {
    let parent: string | null = null;
    for (const item of path) {
      const existing = store.nodes.get(item.id);
      uiAssert(
        !existing || existing.parentId === parent,
        'TREE_INVALID_PARENT',
        '路径父子关系冲突',
      );
      if (!existing) {
        store.nodes.set(item.id, { item, parentId: parent, childIds: [], nodeRevision: 1 });
        store.children.set(item.id, emptyList());
        const list = store.children.get(parent) ?? emptyList();
        uiAssert(!list.complete, 'TREE_INVALID_PATH', '路径与完整子列表冲突');
        const updated = { ...list, ids: [...list.ids, item.id] };
        store.children.set(parent, updated);
        if (parent !== null) {
          store.nodes.set(parent, {
            ...uiRequired(store.nodes.get(parent)),
            childIds: updated.ids,
          });
        }
      }
      parent = item.id;
    }
  }
  private branchPatch(id: string | null): TreePatch {
    const list = this.store.children.get(id) ?? emptyList('loaded');
    const ids = list.ids.flatMap((key) => this.store.descendants(key));
    return {
      upsert: ids.map((key) => uiRequired(this.store.nodes.get(key))),
      lists: [
        [id, list],
        ...ids.map((key): [string, ReturnType<typeof emptyList>] => [
          key,
          uiRequired(this.store.children.get(key)),
        ]),
      ],
      version: this.store.version,
    };
  }
  private async command(
    request: Extract<TreeRequest, { kind: 'command' }>,
    execution: TreeExecution,
    signal: AbortSignal,
  ): Promise<Partial<TreeResponse>> {
    const command = request.command;
    uiAssert(!this.disabled, 'TREE_DISABLED', '树已禁用');
    if (command.type !== 'move') {
      uiAssert(
        ['expand', 'collapse', 'expandAll', 'collapseAll', 'reveal', 'refresh', 'filter'].includes(
          command.type,
        ),
        'TREE_INVALID_COMMAND',
        '树命令无效',
      );
      if (
        'nodeId' in command &&
        (command.type !== 'reveal' || this.store.nodes.has(command.nodeId))
      ) {
        uiAssert(
          !this.store.snapshot(command.nodeId, this.permissions()).disabled,
          'TREE_DISABLED',
          '节点已禁用',
        );
      }
      if (command.type === 'filter') {
        uiAssert(
          this.definition.options.search !== false && typeof command.query === 'string',
          'TREE_INVALID_QUERY',
          '搜索词无效',
        );
        if (!command.query) {
          this.query = '';
        }
      }
      if (command.type === 'refresh' && command.parentId !== null) {
        uiAssert(
          !this.store.snapshot(command.parentId, this.permissions()).disabled,
          'TREE_DISABLED',
          '分支已禁用',
        );
      }
      return { accepted: true, operationId: request.operationId, command };
    }
    uiAssert(
      !this.query && !this.moving && !this.savedPendingRefresh,
      'TREE_MOVE_PENDING',
      '搜索中、移动中或待刷新时不允许排序',
    );
    uiAssert(
      command.expectedVersion === this.store.version,
      'TREE_VERSION_CONFLICT',
      '移动数据版本已变化',
    );
    const move = normalizeTreeMove(
      this.store,
      command.sourceIds,
      command.targetParentId,
      command.beforeId,
      { ...this.definition.options, ...this.permissions() },
    );
    this.moving = true;
    try {
      const parents = new Set([
        command.targetParentId,
        ...move.sourceIds.map((id) => uiRequired(this.store.nodes.get(id)).parentId),
      ]);
      if (this.definition.controllers.move) {
        const raw = await this.invoke(
          'move',
          {
            ...this.base(request),
            kind: 'move',
            operationId: request.operationId,
            ...move,
            targetId: command.beforeId ?? command.targetParentId,
            position:
              command.targetParentId !== null && command.beforeId === null ? 'inside' : 'before',
            expectedVersion: command.expectedVersion,
          },
          execution,
          signal,
        );
        uiValue(raw, TREE_LIMITS.pageBytes);
        const result = raw as unknown as {
          accepted: boolean;
          version?: string;
          invalidateParents?: (string | null)[];
          message?: string;
        };
        uiAssert(
          result && typeof result.accepted === 'boolean',
          'TREE_INVALID_MOVE',
          '移动回执无效',
        );
        if (!result.accepted) {
          return {
            accepted: false,
            message: result.message ?? '移动被拒绝',
            operationId: request.operationId,
          };
        }
        uiAssert(
          typeof result.version === 'string' &&
            result.version.length > 0 &&
            Array.isArray(result.invalidateParents) &&
            result.invalidateParents.every((id) => id === null || this.store.nodes.has(id)),
          'TREE_INVALID_MOVE',
          '已提交的移动回执缺少有效版本或失效列表',
        );
        // Writes have committed. Any subsequent read failure must preserve this receipt.
        this.savedPendingRefresh = true;
        this.store.version = result.version;
        this.rows.clear();
        for (const id of result.invalidateParents) {
          parents.add(id);
        }
        for (const [id, list] of this.store.children) {
          this.store.children.set(id, { ...list, generation: list.generation + 1 });
        }
        return {
          accepted: true,
          saved: true,
          message: '移动已保存，列表待刷新',
          operationId: request.operationId,
          patch: { invalidate: [...parents], version: result.version },
        };
      }
      const next = this.store.clone();
      for (const id of move.sourceIds) {
        const record = uiRequired(next.nodes.get(id)),
          list = uiRequired(next.children.get(record.parentId));
        next.children.set(record.parentId, { ...list, ids: list.ids.filter((key) => key !== id) });
        next.nodes.set(id, {
          ...record,
          parentId: move.targetParentId,
          nodeRevision: record.nodeRevision + 1,
        });
      }
      const target = uiRequired(next.children.get(move.targetParentId));
      const index = move.beforeId === null ? target.ids.length : target.ids.indexOf(move.beforeId);
      const ids = [...target.ids];
      ids.splice(index, 0, ...move.sourceIds);
      next.children.set(move.targetParentId, { ...target, ids });
      for (const parent of parents) {
        if (parent !== null) {
          next.nodes.set(parent, {
            ...uiRequired(next.nodes.get(parent)),
            childIds: uiRequired(next.children.get(parent)).ids,
          });
        }
      }
      this.store = next;
      this.store.version = `static:${++this.sequence}`;
      return {
        accepted: true,
        saved: true,
        operationId: request.operationId,
        patch: this.store.patch(),
      };
    } finally {
      this.moving = false;
    }
  }
  /** Called after an explicit refresh, never replays a write. */
  refreshed() {
    this.savedPendingRefresh = false;
  }
  dispose() {
    this.disposed = true;
    for (const task of this.active.values()) {
      task.controller.abort();
    }
    this.active.clear();
    this.rows.clear();
    this.reads.clear();
    this.operations.clear();
  }
  get nodeCount() {
    return this.store.nodes.size + this.projected.nodes.size;
  }
  get pendingCount() {
    return this.active.size;
  }
  get byteCount() {
    return new TextEncoder().encode(
      JSON.stringify([
        [...this.store.nodes.values()],
        [...this.projected.nodes.values()],
        [...this.rows.values()],
      ]),
    ).length;
  }
}
export class TreeSessions {
  sessions = new Map<string, TreeSession>();
  private signature = '';
  sync(trees: CompiledTree[] = [], options: TreeCompileOptions, registration: unknown = '') {
    const signature = JSON.stringify(registration);
    if (signature !== this.signature) {
      this.dispose();
      this.signature = signature;
    }
    const retained = new Set(trees.map((tree) => tree.treeId));
    for (const [id, session] of this.sessions) {
      if (!retained.has(id)) {
        session.dispose();
        this.sessions.delete(id);
      }
    }
    for (const tree of trees) {
      let session = this.sessions.get(tree.treeId);
      if (!session || session.definition.signature !== tree.signature) {
        session?.dispose();
        const nextSession = new TreeSession(tree, options);
        nextSession.checkInstance = (nodes, bytes) => {
          const others = [...this.sessions.values()].filter((other) => other !== nextSession);
          uiAssert(
            nodes + others.reduce((sum, tree) => sum + tree.nodeCount, 0) <=
              TREE_LIMITS.instanceNodes &&
              bytes + others.reduce((sum, tree) => sum + tree.byteCount, 0) <=
                TREE_LIMITS.instanceBytes,
            'TREE_QUOTA_EXCEEDED',
            '实例树缓存达到上限',
          );
        };
        this.sessions.set(tree.treeId, nextSession);
      } else {
        tree.dataEpoch = session.definition.dataEpoch;
        // Binding identities and ASTs belong to the retained session.
        tree.bindings = session.definition.bindings;
        tree.defaults = session.definition.defaults;
        tree.nodes = session.definition.nodes;
        session.definition.hostNodeId = tree.hostNodeId;
        for (const binding of tree.bindings) {
          binding.nodeId = tree.hostNodeId;
        }
      }
    }
    return this;
  }
  get(id: string) {
    const session = this.sessions.get(id);
    uiAssert(session, 'TREE_UNKNOWN_TREE', '树不属于当前实例');
    return session;
  }
  field(name: string) {
    return [...this.sessions.values()].find((tree) => tree.definition.name === name);
  }
  quota() {
    uiAssert(
      [...this.sessions.values()].reduce((sum, tree) => sum + tree.pendingCount, 0) <
        TREE_LIMITS.instanceConcurrent &&
        [...this.sessions.values()].reduce((sum, tree) => sum + tree.nodeCount, 0) <=
          TREE_LIMITS.instanceNodes &&
        [...this.sessions.values()].reduce((sum, tree) => sum + tree.byteCount, 0) <=
          TREE_LIMITS.instanceBytes,
      'TREE_QUOTA_EXCEEDED',
      '实例树数据或并发达到上限',
    );
  }
  dispose() {
    for (const tree of this.sessions.values()) {
      tree.dispose();
    }
    this.sessions.clear();
  }
}
