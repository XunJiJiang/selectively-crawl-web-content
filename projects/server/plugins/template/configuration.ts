import type { ConfigChange, ConfigDefinition, PluginConfig } from '../../types/plugin-config.d.ts';

const item = (
  id: string,
  label: string,
  control: ConfigDefinition['items'][number]['control'],
  defaultValue: string,
  rules?: ConfigDefinition['items'][number]['rules'],
  description?: string,
): ConfigDefinition['items'][number] => ({
  id,
  key: `validation.${id}`,
  label,
  description,
  control,
  defaultValue,
  validationPolicy: id === 'note' ? 'backend-required' : 'declarative',
  rules,
});
let config: PluginConfig | undefined;
let stop: (() => void) | undefined;
const changes: (ConfigChange & { source: string })[] = [];
export const configuration = {
  definitions: [
    {
      id: 'template-validation',
      schemaVersion: '3',
      label: '接入验证',
      description: '配置在后端统一校验，保存后同步到所有视图。',
      groups: [
        {
          id: 'messages',
          label: '验证说明',
          description: '分组标题下方的说明文字。',
          itemIds: ['note', 'memo'],
        },
        {
          id: 'limits',
          label: '任务限制',
          footer: '分组下方的说明：数量必须为 1–10 之间的整数。',
          itemIds: ['limit'],
        },
      ],
      items: [
        item(
          'note',
          '说明',
          'text',
          '声明式 UI 已接入',
          { maxLength: 120 },
          '保存时去除首尾空格；包含 reject 会被后端拒绝。',
        ),
        item('memo', '备注', 'textarea', '多行说明', { maxLength: 500 }, '演示多行输入控件。'),
        item('limit', '数量上限', 'number', '3', { codec: 'integer', min: 1, max: 10 }),
      ],
    },
    {
      id: 'template-appearance',
      schemaVersion: '2',
      label: '外观',
      footer: '修改后点击保存更改。',
      groups: [
        {
          id: 'behavior',
          label: '开关与勾选',
          description: '开关在右侧，checkbox 在文字左侧。',
          itemIds: ['enabled', 'confirm'],
        },
        {
          id: 'style',
          label: '显示',
          itemIds: ['mode', 'color'],
        },
        {
          id: 'contract',
          label: '接口信息',
          footer: '只读项不能通过配置表单修改。',
          itemIds: ['contract'],
        },
      ],
      items: [
        item('enabled', '启用验证', 'switch', 'true', { codec: 'boolean' }),
        item(
          'confirm',
          '勾选验证项',
          'checkbox',
          'false',
          { codec: 'boolean' },
          '演示 checkbox 与设置说明的布局。',
        ),
        item('mode', '布局密度', 'select', 'compact', { options: ['compact', 'comfortable'] }),
        item('color', '主题色', 'color', '#38bdf8'),
        item('contract', '页面接口版本', 'readonly', 'pageApiVersion=2'),
      ],
    },
  ] satisfies ConfigDefinition[],
  async normalize(values: Record<string, string>) {
    return {
      ...values,
      ...(values['validation.note'] === undefined
        ? {}
        : {
            'validation.note': values['validation.note'].trim(),
          }),
    };
  },
  async validate(values: Record<string, string>): Promise<true | string> {
    return values['validation.note']?.toLowerCase().includes('reject')
      ? '验证说明不能包含 reject（后端异步校验）'
      : true;
  },
  onChange(change: ConfigChange) {
    remember(change, 'configuration.onChange');
  },
};
function remember(change: ConfigChange, source: string) {
  changes.unshift({ ...change, source });
  changes.splice(20);
}
export function loadConfiguration(value: PluginConfig) {
  config = value;
  stop = value.subscribe((change) => remember(change, 'config.subscribe'));
}
export function unloadConfiguration() {
  stop?.();
  stop = undefined;
  config = undefined;
}

// 页面只能调用本插件明确声明的业务 API；不向页面恢复 config.set/reset。
export const configurationApis: SCWC.TPluginApi[] = [
  {
    method: 'POST',
    path: '/validation/config',
    async handler(data) {
      if (!config || !data || typeof data !== 'object') throw new Error('配置未就绪或参数无效');
      const body = data as Record<string, unknown>;
      const action = String(body.action);
      if (action === 'list') return config.list();
      if (action === 'get') return { value: (await config.get('validation.note')) ?? null };
      if (action === 'changes') return changes;
      if (action === 'unsubscribe') {
        stop?.();
        stop = undefined;
        return { subscribed: false };
      }
      if (action === 'subscribe') {
        stop?.();
        stop = config.subscribe((change) => remember(change, 'config.subscribe'));
        return { subscribed: true };
      }
      if (!Number.isInteger(body.baseRevision) || Number(body.baseRevision) < 0)
        throw new Error('先读取配置快照，写入必须显式携带 baseRevision');
      const options = { baseRevision: Number(body.baseRevision) };
      if (action === 'delete') return config.delete('validation.note', options);
      if (action === 'reset') return config.reset(['validation.note', 'validation.memo'], options);
      if (typeof body.value !== 'string') throw new Error('value 必须是字符串');
      if (action === 'set') return config.set('validation.note', body.value, options);
      if (action === 'update')
        return config.update(
          {
            'validation.note': body.value,
            'validation.memo': '由后端 update 同批写入',
          },
          options,
        );
      throw new Error('未知配置操作');
    },
  },
];
