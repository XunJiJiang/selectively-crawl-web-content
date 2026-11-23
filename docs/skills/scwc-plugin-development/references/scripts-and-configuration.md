# 用户脚本、浏览器扩展与持久配置

协议读 `projects/shared/script-ui.ts` 与 `projects/server/router/plugin.ts`，执行和存储读 `projects/server/user-script/{ui,ui-config,refresh}.ts` 与 `projects/server/workbench/plugin-config.ts`。两端共用 `projects/shared/components/script-ui.ts`，刷新与事件由各自客户端编排。

## 协议选择

- **维护旧控件。** `pluginConfig.scripts.version` 省略或为 `'v1'` 时，`controls` 为数组或按 site 生成的控件工厂。支持 `button/toggle/select/input:text/input:number/checkbox`，channel 在插件内稳定且唯一。默认值、关联通道和触发条件见 `options` 的 `defaultValue/relatedChannel/autoTrigger/requireFullContent`。按实际值校验旧数字输入，其中可能含字符串。trigger 可读取 `value/relatedValues/data/site` 和可选 `signal/tasks`，反馈通过返回 notification。
- **声明式配置。** 显式设置 `version: 'v2'`，提供 `content`、`handlers`。内容可为具体对象或接收 `ScriptContext` 的工厂。JSON 使用 `{ format: 'json', version: 1, root }`，可用 `components` 在后端展开自定义节点并使用 JSON 树。HTML 使用 `{ format: 'html', version: 2, html }`，支持受限标签、局部 CSS 和声明式事件。HTML 节点和样式须符合 `projects/shared/script-html-policy.ts`，禁外链资源和树。template 在匹配网站上以 `?template-ui=html` 切换示例。
- **兼容版本。** 核心协商 v2 的客户端最低版本。普通 JSON 为 `3.2.0`，带树的 JSON 为 `3.4.0`，HTML 为 `3.4.14`。仍维护 v1 时保留既有控件行为，由宿主处理兼容元数据。

## 最小 v2 交互

将下例赋给 handler 的 `pluginConfig.scripts` 即可由脚本或扩展渲染。

```ts
export const scripts: SCWC.TScriptConfigV2 = {
  version: 'v2',
  title: '批量处理',
  requireFullContent: false,
  content: {
    format: 'json',
    version: 1,
    root: {
      type: 'stack',
      children: [
        {
          type: 'input', name: 'item-count', inputType: 'number',
          value: '3', min: 1, max: 10,
          validator: 'validate.count($this)',
        },
        {
          type: 'button', text: '提交', for: 'item-count',
          events: { click: 'core:number.parse($for:item-count)|submit($prev)' },
        },
      ],
    },
  },
  handlers: {
    'validate.count': {
      readOnly: true,
      run(value) {
        return { success: Number.isInteger(Number(value)), message: '数量必须是整数' };
      },
    },
    submit: {
      run(value) {
        this.logger.info('处理数量', value);
        return { type: 'notification', data: { type: 'success', message: '处理完成' } };
      },
    },
  },
};
```

用普通 `run` 方法取得 `this: ScriptContext`，含 `version/site/data/values/logger` 和可选 `signal/tasks`。用 `for` 声明关联字段，再以 `$for:name` 或 `this.values` 读取。validator 与模板处理器标记只读，提交处理器验证业务权限和外部数据。[字段与表达式规则](declarative-ui.md)

v2 函数和事件程序留在插件进程，客户端发送已签发的 `bindingId` 和字段快照。使用后端 handlers、`user-script/ui.ts` 的 core 白名单及配置 bound read/write。`watch:` 仅用于受支持的配置绑定读取。事件反馈返回 notification，后台主动通知走站点通知 API。[运行契约](runtime-contract.md#通知与任务)

`requireFullContent` 默认为 true，非只读事件按此选项检查抓取项。无需采集时设 false。模板和只读请求无需采集。普通交互字段作为网站草稿保存，包括密码输入。数字用字符串，多选用字符串数组。示例默认值和日志避免真实凭据。

实例按完整 URL 隔离，当前最多 128 个，闲置 15 分钟过期。客户端合并同插件刷新，保留其他插件和脏字段，拒绝旧 URL 或旧代响应。过期只读恢复一次，提交不重放。

## URL 刷新与网站范围

`refreshRule/refreshRules` 两代可用。首个 `sites` 命中的覆盖默认，缺省为 `'//'`（检测 pathname），`''` 忽略同站 URL 变化。新增适用插件首载，策略变化触发刷新。刷新策略以插件声明为准。

规则以 `//`、`?`、`#` 分别标记 pathname、query、hash，未声明区域忽略。逐段和增删策略见 `projects/shared/utils/refreshRule{Parser,Matcher}.ts` 及测试。`refreshRules.sites` 沿用 `link-with` 的首匹配和否定顺序。

v2 用原编码 URL 做适用匹配、刷新判断、模板实例和事件绑定。`previousSite` 必须同源。v1 沿用解码后的 URL。验证含编码分隔符或中文的 URL 时，用同一未解码地址取模板并执行事件，检查刷新后旧实例失效。

持久网站配置按规范 HTTP(S) origin 隔离，同源路径、query、hash 和 iframe 共享快照。

## 后端全局配置与分组

`context.config` 按插件目录隔离，提供 `get/list/set/update/delete/reset/subscribe`。持久值与默认值均为字符串，点号按键名原样保存。只读快照的 `values` 是显式值，`effectiveValues` 含默认值，`revision/schemaRevision` 分别对应值与定义版本。

`configuration.definitions` 声明 `id/schemaVersion/items`。每项有独立 `id`、持久 `key` 及 `label/control/defaultValue/validationPolicy/rules`。可异步 `normalize(values)` 和 `validate(values)`，后者以 true 表示成功、字符串表示错误。标准化保留键集及字符串类型。`onChange/subscribe` 处理成功变更，卸载释放订阅。

布局用 `groups: [{ id, label?, description?, footer?, itemIds }]` 引用当前定义的 `items.id`。组 ID 唯一，每项至多归一组且引用必须存在。未分组项与旧平铺定义继续显示，组标题变更无需迁移持久键。

页面写入走后端 API，校验键白名单、业务规则及已读的 `baseRevision` 后调用配置接口。核心在异步校验后重验基线。冲突保留草稿，由用户处理新版本。旧 `legacy-unverified/page-required` 定义维持只读。

## JSON 自动绑定与显式控制器

下例可用于 v2 配置与工作台。先在后端配置定义中声明示例使用的持久键。

```json
{
  "format": "json",
  "version": 1,
  "root": {
    "type": "group", "label": "处理选项",
    "children": [
      {
        "type": "setting", "name": "batch-limit", "label": "数量上限",
        "config": "batch.limit", "valueType": "integer", "defaultValue": "3",
        "min": 1, "max": 10
      }
    ]
  }
}
```

`configScope` 默认为 `'plugin'`，与工作台和 `context.config` 共用全局值。脚本和扩展还可用 `'site'` 按 origin 保存本站键，本站布尔存布尔、数字存字符串。`defaultValue` 一律写字符串。绑定与 `children/events` 互斥，`name` 可由核心生成，手写时遵循控件命名规则。

`valueType` 为 `string/boolean/number/integer`，`control` 可选 `text/password/textarea/number/switch/checkbox/select/color/readonly`。默认有 options 用 select，布尔用 switch，数值用 number，其余用 text。显式选择须匹配类型。由运行器处理校验和保存，刷新保留原配置基线。绑定字段独立于普通草稿。

需要自定义控制器时，在 `setting.children` 放一个控件并声明 `events`。工作台可用 `watch:core:config.bound.read(key, field, fallback)` 配对 `core:config.bound.write(key, field, value)`。template 的 `settings-ui.ts` 演示标准化、整数校验和双基线保护。Web 页面写配置走后端业务 API。

按改动验证全局视图同步、本站隔离、非法组引用、草稿冲突、标准化回值和 blur/提交失败阻断。脚本与扩展均覆盖。复用 template 集成测试、`user-script/ui-config.test.ts` 与客户端测试。
