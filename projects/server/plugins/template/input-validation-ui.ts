import type {
  HandlerDefinition,
  UIContent,
  UINode,
  UIValue,
  UIValidationResult,
} from 'scwc:shared/backend';

/** Pure callbacks can be registered in both workbench.ui and scripts.handlers. */
export const inputValidationHandlers = {
  'validation.guide': {
    readOnly: true,
    run() {
      return '输入长度、数值与格式先检查，再调用自定义验证器。全部通过才执行提交。';
    },
  },
  'validation.available': {
    readOnly: true,
    async run(value: UIValue): Promise<UIValidationResult> {
      // Replace this pure lookup with an awaited read-only service in a real plugin.
      const reserved = await Promise.resolve(['admin', 'root']);
      return typeof value === 'string' && !reserved.includes(value.toLowerCase())
        ? { success: true }
        : { success: false, message: '此名称已保留，请换一个名称（异步验证器）' };
    },
  },
  'validation.same': {
    readOnly: true,
    run(value: UIValue, password: UIValue): UIValidationResult {
      return typeof value === 'string' && value === password
        ? { success: true }
        : { success: false, message: '两次示例密码不一致' };
    },
  },
  'validation.memo': {
    readOnly: true,
    run(value: UIValue): UIValidationResult {
      return typeof value === 'string' && !value.includes('reject')
        ? { success: true }
        : { success: false, message: '备注不能包含 reject（自定义验证器）' };
    },
  },
  'validation.locked': {
    readOnly: true,
    run() {
      return true;
    },
  },
  'validation.invalidResult': {
    readOnly: true,
    run() {
      // Intentional negative example. A boolean is NOT a UIValidationResult.
      return true;
    },
  },
  'validation.submit': {
    run() {
      // Do not echo field contents: script fields are drafts, including demo passwords.
      return {
        type: 'notification',
        data: { type: 'success', message: '输入验证通过，示例提交已执行' },
      };
    },
  },
  'validation.event': {
    run(...args: UIValue[]) {
      return {
        type: 'notification',
        data: { type: 'info', message: `事件控制器收到 ${args.length} 个参数` },
      };
    },
  },
} satisfies Record<string, HandlerDefinition>;

const setting = (label: string, description: string, control: UINode): UINode => ({
  type: 'setting',
  label,
  description,
  children: [control],
});

/** The same v2 examples render in both sidebars, the status tooltip, userscripts and extensions. */
export function inputValidationContent(target: 'workbench' | 'scripts' = 'workbench'): UINode[] {
  // Scripts consume notification return values; workbench surfaces use explicit core effects.
  const notify = (program: string, level = 'success') =>
    target === 'scripts'
      ? program
      : `${program}|core:notification.show(core:object.get($prev,['data','message']),'${level}')`;
  return [
    { type: 'text', text: '${validation.guide()}' }, // Templates require explicit parentheses.
    {
      type: 'text',
      tone: 'muted',
      text: '密码仅用于演示。脚本/扩展会保存字段草稿，请使用下面的示例值。',
    },
    {
      type: 'group',
      key: 'input-validation-limits',
      label: '输入限制',
      children: [
        setting(
          '名称（text）',
          '3–16 字符，只允许字母、数字、下划线、中划线；admin/root 会被异步验证器拒绝。',
          {
            type: 'input',
            inputType: 'text',
            name: 'validation_text-1',
            value: 'demo_user',
            placeholder: '例如 demo_user',
            minLength: 3,
            maxLength: 16,
            pattern: '[A-Za-z0-9_-]+',
            patternMessage: '名称只能包含字母、数字、下划线和中划线',
            validator: 'validation.available($this)',
          },
        ),
        setting('数量（number）', '1–10，最多两位小数；长度 1–5，校验后仍保存字符串。', {
          type: 'input',
          inputType: 'number',
          name: 'validation_number',
          value: '3',
          placeholder: '1–10',
          min: 1,
          max: 10,
          step: 'any',
          minLength: 1,
          maxLength: 5,
          pattern: '\\d+(?:\\.\\d{1,2})?',
          patternMessage: '请输入最多两位小数的数字',
        }),
        setting('示例密码（password）', '8–24 字符，必须同时包含字母和数字。示例值 Demo1234。', {
          type: 'input',
          inputType: 'password',
          name: 'validation_password',
          value: 'Demo1234',
          placeholder: 'Demo1234',
          minLength: 8,
          maxLength: 24,
          pattern: '(?=.*[A-Za-z])(?=.*[0-9])[A-Za-z0-9_-]+',
          patternMessage: '示例密码必须包含字母和数字，且只能使用字母、数字、下划线和中划线',
        }),
        setting('说明（textarea）', '4–80 字符，可换行；不能包含尖括号。', {
          type: 'textarea',
          name: 'validation_memo',
          value: '这是一段示例说明',
          placeholder: '输入至少四个字符的说明',
          minLength: 4,
          maxLength: 80,
          pattern: '[^<>]+',
          patternMessage: '说明不能包含 < 或 >',
        }),
        setting(
          '再次输入示例密码',
          '$this 读取当前控件值，$for:validation_password 读取上面的密码值。',
          {
            type: 'input',
            inputType: 'password',
            name: 'validation_confirm',
            value: 'Demo1234',
            placeholder: '再次输入 Demo1234',
            minLength: 8,
            maxLength: 24,
            validator: 'validation.same($this, $for:validation_password)',
          },
        ),
      ],
    },
    {
      type: 'button',
      key: 'validation-submit',
      text: '验证并提交示例',
      for: [
        'validation_text-1',
        'validation_number',
        'validation_password',
        'validation_memo',
        'validation_confirm',
      ],
      events: { click: notify('validation.submit()') },
    },
    {
      type: 'group',
      key: 'input-validation-attributes',
      label: '占位、只读与禁用',
      description: '每种控件各提供一个只读和一个禁用示例；只读允许选择文本。',
      children: ['text', 'number', 'password', 'textarea'].flatMap((kind) => {
        const control =
          kind === 'textarea' ? { type: 'textarea' } : { type: 'input', inputType: kind };
        return [
          setting(`${kind} · readonly`, 'readonly 使用返回布尔值的显式模板调用。', {
            ...control,
            name: `validation_readonly_${kind}`,
            value: kind === 'number' ? '7' : 'Demo1234',
            placeholder: '只读占位',
            readonly: '${validation.locked()}',
          }),
          setting(`${kind} · disabled`, '禁用控件为空时仍显示 placeholder。', {
            ...control,
            name: `validation_disabled_${kind}`,
            value: '',
            placeholder: '已禁用',
            disabled: true,
          }),
        ];
      }),
    },
    {
      type: 'group',
      key: 'input-validation-bound',
      label: '自动绑定也支持验证',
      children: [
        {
          type: 'setting',
          name: 'validation_bound_memo',
          label: '全局备注',
          description:
            '与全局配置页共用 validation.memo；4–500 字符，禁止尖括号与 reject，修改后自动保存。',
          config: 'validation.memo',
          control: 'textarea',
          minLength: 4,
          maxLength: 500,
          placeholder: '输入全局备注',
          pattern: '[^<>]+',
          patternMessage: '备注不能包含 < 或 >',
          validator: 'validation.memo($this)',
        },
      ],
    },
    {
      type: 'group',
      key: 'input-validation-negative',
      label: '错误返回值（预期报错）',
      children: [
        setting(
          '非法验证结果',
          '本例故意返回 true。修改、失焦或点击下方按钮，应提示必须返回 success/message 对象。',
          {
            type: 'input',
            name: 'validation_bad_result',
            value: '演示错误返回值',
            placeholder: '修改后观察错误',
            validator: 'validation.invalidResult($this)',
          },
        ),
      ],
    },
    {
      type: 'button',
      text: '触发错误返回值',
      for: 'validation_bad_result',
      events: { click: notify('validation.submit()') },
    },
    {
      type: 'text',
      text: '调用语法：仅控件事件顶层可省略括号；模板、嵌套调用和 validator 必须写出 ()。控件名示例 validation_text-1 合法，validation.text 和含空格名称非法。',
    },
    {
      type: 'button',
      text: '事件裸调用（1 个参数）',
      events: { click: notify('validation.event', 'info') },
    },
    {
      type: 'button',
      text: '显式空括号（0 个参数）',
      events: { click: notify('validation.event()', 'info') },
    },
  ];
}

/** Never publish these as initial content; the UI offers explicit rejection demonstrations. */
export const invalidInputExamples: {
  action: string;
  label: string;
  root: UINode;
  error: RegExp;
}[] = [
  {
    action: 'reject.template-call',
    label: '模板省略括号（预期拒绝）',
    root: { type: 'text', text: '${validation.guide}' },
    error: /括号/,
  },
  {
    action: 'reject.validator-call',
    label: '验证器省略括号（预期拒绝）',
    root: { type: 'input', name: 'valid_name', validator: 'validation.available' },
    error: /括号/,
  },
  {
    action: 'reject.control-name',
    label: '控件名含点号（预期拒绝）',
    root: { type: 'input', name: 'invalid.name' },
    error: /name/,
  },
  {
    action: 'reject.control-space',
    label: '控件名含空格（预期拒绝）',
    root: { type: 'input', name: 'invalid name' },
    error: /name/,
  },
];

export function rejectedInputContent(example: (typeof invalidInputExamples)[number]): UIContent {
  return { format: 'json', version: 1, root: example.root };
}
