# 用户脚本、浏览器扩展与持久配置

源码入口：`projects/shared/script-ui.ts`、`projects/server/user-script/{ui,ui-config,refresh}.ts`、`projects/server/types/plugin-config.d.ts`、`projects/server/workbench/plugin-config.ts`。两客户端共用 `projects/shared/components/script-ui.ts`；同时检查脚本 layouts/hooks/plugins.ts 与扩展 popup.ts/background.ts 的刷新和事件路径。

## 协议选择

pluginConfig.scripts 接受两代协议。省略 version 或 `'v1'` 使用原 controls；显式 `'v2'` 使用 JSON 内容、handlers 和可选 components。两者互斥，不能在 v2 中混入 controls，也不能将核心进程 apiVersion: 2 当成脚本 'v2'。

v1 支持 button/toggle/select/input:text/input:number/checkbox，controls 为数组或按 site 返回数组的工厂。channel 稳定且插件内唯一；options 包含 defaultValue、relatedChannel、autoTrigger、requireFullContent 等。trigger 取得 value、relatedValues、data/site、可选 signal/tasks 和普通 logger，返回 notification 对象；没有采集 logger 的 toWeb。旧数字输入实际可能为字符串，按收到的数据校验，不照搬历史注释的数字假设。

v2 使用 SCWC.TScriptConfigV2，内容是 `{ format: 'json', version: 1, root }` 或接收 ScriptContext 的异步工厂。外层 version 为字符串 'v2'，内层为数字 1。`{ type: 'custom', component: '名称', props: {...} }` 经后端 components 展开为同一套 JSON 节点，不是浏览器自定义元素；脚本 JSON 不支持远程图片资源，优先内置图标。当前兼容元数据 SCRIPT_CONFIG_RANGES 为 v1 `0.0.1-3.1.29`、v2 `3.2.0-*`；新客户端仍渲染 v1，不应因 v1 范围上限把现有插件拒绝掉。实际协商与路由版本门槛交给核心，不在插件里伪造客户端版本或兼容范围。

## 最小 v2 交互

以下内容可赋给 handler 的 pluginConfig.scripts；不需要独立 ui.entry 页面：

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

run 用普通方法取得 `this: ScriptContext`，其中有当前 version/site/data/values/logger、可选 signal/tasks；values 是字段值集合，与工作台 HandlerContext 不同。用 for 声明关联/提交字段，引用 $for:name 或在 this.values 中读取。validator 和模板处理器标记只读；提交处理器自行验证业务权限与外部数据。校验、命名、显式括号规则见[声明式 UI](declarative-ui.md)。

v2 函数和事件程序留在插件进程，浏览器只提交 bindingId/字段快照，不发送任意程序。只支持后端 handlers、纯 core 内置子集及配置 bound read/write；不支持 ui: 前端 handler、自定义 watch、工作台页面操作或 core:notification.show。需要反馈时返回 notification。纯 core 子集见 user-script/ui.ts 的 builtins，不将工作台示例整体复制过来。

requireFullContent 缺省 true，非只读事件会走采集路径并按该选项检查抓取项；无采集需求的配置设 false。模板和定期只读请求不应触发页面采集，验证器自身保持只读。普通交互字段作为网站草稿保存，数字仍是 string、多选 string[]；密码输入也属于草稿，别把真实凭据放在示例默认值或回显日志里。

实例按完整 URL 隔离（当前最多 128 个、15 分钟闲置过期），而网站配置按 origin 共享，两者不同。客户端合并同插件刷新、保留未刷新的其他插件和脏字段，拒绝旧 URL/旧代结果；过期只读可恢复一次，提交不重放。修改插件时保留这些已有机制，不自己循环请求或在冲突后自动重交。

## URL 刷新与网站范围

refreshRule/refreshRules 两代 scripts 都可用。首个 sites 命中的 refreshRules 覆盖默认；未声明默认为 `'//'`（检测 pathname），`''` 忽略同站 URL 变化。新增适用插件首次加载；策略变化也刷新。用户本地旧 refreshRule 字段不再决定插件模板刷新。

规则由 `projects/shared/utils/refreshRuleParser.ts` 和 refreshRuleMatcher.ts 解析，不是正则：pathname 用 //、query 用 ?、hash 用 #，区域未声明则忽略。需要复杂增删/逐段策略时读解析器及测试，别凭 README 猜语法。refreshRules.sites 沿用 link-with 匹配，注意首匹配与否定顺序。

网站配置使用 HTTP(S) 的规范 origin；同站不同 pathname/query/hash 与 iframe 共用快照，其他 origin 分开。URL 变化导致 UI 实例切换不意味着要另建一套路径配置存储。

## 后端全局配置与分组

context.config 已隔离插件目录，提供 get/list/set/update/delete/reset/subscribe。持久值、defaultValue 一律 string，包括布尔 'true'/'false' 和数字；点号 key 是字面键，不做对象路径展开。页面只读快照中的 values 是显式值，effectiveValues 含默认值；revision 表示值版本，schemaRevision 表示定义版本。

configuration.definitions 每个定义含 id/schemaVersion/items；item 含独立 id、实际 key、label/control/defaultValue、validationPolicy 和 rules。业务校验由异步 normalize(values)、`validate(values): true | string` 承担；normalize 保持键集和值为字符串，不能顺便添加/删除字段。onChange/subscribe 处理成功后的变更，卸载释放订阅。

定义的 `groups: [{ id, label?, description?, footer?, itemIds }]` 只控制布局，引用本定义权威 items 的 **id**，不是 key，也不复制 items 或值。组 id 不重复、同项不重复归组、引用不可悬空；未分组项与旧平铺定义继续工作。改组标题不等于数据迁移，别为布局改写持久键。

后端 API 处理来自页面的写入时，验证键白名单、业务规则与显式读取过的 baseRevision，再调用 config 写接口；核心会在异步校验后重验 CAS。并发冲突保留草稿，不能静默取新 revision 覆盖。旧 legacy-unverified、page-required 定义不能直接当作已通过后端验证的可编辑配置。

## JSON 自动绑定与显式控制器

下例是 v2 content 或工作台内容的全局设置；先在后端配置定义中声明相同持久 key：

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

configScope 缺省 'plugin'，与工作台核心配置、context.config 共用全局持久值。脚本/扩展还可设 'site'，按 origin 保存本站键，不加入全局 configuration.items；工作台当前不支持 site 配置绑定。site 布尔存布尔、数字存字符串；defaultValue 仍写字符串。两者都不能与 children/events 混用。控件 name 可省略由核心生成；手写时与 config 的点号键分开命名。

valueType 为 string/boolean/number/integer；control 可选 text/password/textarea/number/switch/checkbox/select/color/readonly。有 options 默认 select，boolean 默认 switch，数值默认 number，其他默认 text；显式 control 必须与类型兼容。校验和保存时机由编译器/运行器完成，不附加另一路 change 写入。自动绑定字段不复制进普通草稿；刷新须保留其原始配置基线，避免把外部更新覆盖成旧值。

自定义设置行使用 setting.children 放单一控件并显式声明 events。工作台可用 `watch:core:config.bound.read(key, field, fallback)` 配对 `core:config.bound.write(key, field, value)`；模板 settings-ui.ts 的 controllerSettings 示范字符串标准化、整数检查和双基线保护。单纯全局/本站配置优先用自动绑定，减少手动处理基线与编码。自定义 Web 页面的写配置仍走后端业务 API，不向 scwcutils.config 补写接口。

验证配置时覆盖全局两视图同步、同 origin 共享/异 origin 隔离、组引用错误、草稿与外部变更冲突、normalize 后字段校验、输入不触发隐式控制器、blur/提交首错阻断。脚本与扩展均应验证；已有 template/tests/integration.test.mjs、user-script/ui-config.test.ts、shared script-ui 和客户端测试可作模式参考。
