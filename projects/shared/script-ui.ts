import type { CompiledUI, FieldValue, UIContent, UINode, UIValue } from './declarative-ui.ts';
import { CLIENT_VERSION, inVersionRange } from './client-version.ts';

export const SCRIPT_CONFIG_RANGES = { v1: '0.0.1-3.1.29', v2: '3.2.0-*' };
export type ScriptVersion = 'v1' | 'v2';
export interface ScriptContext {
  version: 'v2';
  site: Parameters<SCWC.TCreatePluginItem>[1]['site'];
  data: SCWC.TDataItem[];
  values: Record<string, FieldValue>;
  signal?: AbortSignal;
  tasks?: SCWC.TaskReporter;
  logger: SCWC.TLogger;
}
export interface ScriptHandler {
  readOnly?: boolean;
  run(this: ScriptContext, ...args: UIValue[]): UIValue | void | Promise<UIValue | void>;
}
export interface ScriptConfigV2 {
  /** v2 must be explicit; omitted versions retain the original controls contract. */
  version: 'v2';
  controls?: never;
  title: string;
  description?: string;
  refreshRule?: string;
  refreshRules?: { sites: string[]; rule: string }[];
  requireFullContent?: boolean;
  content:
    | Extract<UIContent, { format: 'json' }>
    | ((
        context: ScriptContext,
      ) =>
        | Extract<UIContent, { format: 'json' }>
        | Promise<Extract<UIContent, { format: 'json' }>>);
  handlers?: Record<string, ScriptHandler>;
  /** Backend components expand to the same JSON nodes as sidebars and tooltips. */
  components?: Record<string, (props: UIValue, context: ScriptContext) => UINode | Promise<UINode>>;
}
export interface ScriptUIModel {
  instanceId: string;
  compiled: CompiledUI;
  updates: { id: string; value: UIValue }[];
}
export interface ScriptUIEvent {
  version: 'v2';
  instanceId: string;
  eventId: string;
  bindingId: string;
  fields: Record<string, { value: FieldValue; editSequence: number }>;
  event?: { modifiers?: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean } };
}
export interface ScriptUIResult {
  result?: UIValue;
  updates: ScriptUIModel['updates'];
}
export function scriptConfigProblem(
  config: { version?: string; compatibleVersions?: Record<string, string> },
  current = CLIENT_VERSION,
): string | undefined {
  const version = config.version ?? 'v1';
  const range =
    config.compatibleVersions?.[version] ?? SCRIPT_CONFIG_RANGES[version as ScriptVersion];
  // v1 remains renderable on v2 clients during the migration period. Ranges identify its authoring generation.
  if (
    ['v1', 'v2'].includes(version) &&
    range &&
    (version === 'v1' || inVersionRange(current, range))
  ) {
    return;
  }
  return `插件配置不兼容：需要 ${version}（版本范围 ${range ?? '未知'}），当前版本 ${current}。请升级插件及脚本或扩展。`;
}
type SavedControl = { pluginId: string; channel: string; value: string | number | boolean | null };
export function readScriptValues(
  pluginId: string,
  model: ScriptUIModel,
  controls: SavedControl[],
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const field of model.compiled.fields) {
    const saved = controls.find(
      (item) => item.pluginId === pluginId && item.channel === `v2:${field.name}`,
    );
    if (!saved) {
      continue;
    }
    if (field.kind === 'boolean' && typeof saved.value === 'boolean') {
      values[field.name] = saved.value;
    } else if (field.kind === 'string' && typeof saved.value === 'string') {
      values[field.name] = saved.value;
    } else if (field.kind === 'multiple' && typeof saved.value === 'string') {
      try {
        const value: unknown = JSON.parse(saved.value);
        if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
          values[field.name] = value;
        }
      } catch {
        /* invalid old value */
      }
    }
  }
  return values;
}
export function saveScriptValues(
  pluginId: string,
  values: Record<string, FieldValue>,
  controls: SavedControl[],
): SavedControl[] {
  return [
    ...controls.filter((item) => item.pluginId !== pluginId || !item.channel.startsWith('v2:')),
    ...Object.entries(values).map(([name, value]) => ({
      pluginId,
      channel: `v2:${name}`,
      value: Array.isArray(value) ? JSON.stringify(value) : value,
    })),
  ];
}
