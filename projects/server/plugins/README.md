# 插件

## 插件开发说明

### 用户脚本的 URL 刷新规则

每个插件在 `pluginConfig.scripts` 中声明自己的规则，用户不能在悬浮窗中编辑。`refreshRule` 是默认规则（省略时为 `//`），`refreshRules` 为不同网站提供覆盖，按顺序取首个命中项；`sites` 使用 `link-with` 的 URL 前缀、`*` 通配符及 `!` 排除语法。空规则表示忽略同一网站内的 URL 变化。

```ts
pluginConfig: {
  scripts: {
    title: '网页采集',
    refreshRule: '//',
    refreshRules: [
      { sites: ['https://one.example/*'], rule: '?page&id' },
      { sites: ['https://two.example/*'], rule: '#' },
    ],
    controls: (logger, { site }) => [/* 当前网址的控件 */],
  },
}
```

`//` 检测 pathname，`?` 检测查询参数，`#` 检测 hash；`\i` 忽略、`\c` 变化、`\a` 出现、`\d` 消失。路径/hash 按段匹配，末尾 `/` 停止后续继承；查询参数无序，重复键的值按集合顺序无关比较。具体规则见共享配置类型中的语法说明。URL 变化只重建命中规则的插件控件；新进入适用范围的插件会首次加载，离开的插件会移除。首次连接和核心重连仍会加载当前页面的完整插件配置。

插件用于自定义不同网站的数据处理逻辑，需放置于 `server/plugins/` 目录下，支持 TypeScript/JavaScript。

### 插件结构

每个插件为一个独立的包目录，需包含 `package.json` 和主模块文件（如 `index.ts`）。

**示例目录结构：**

```tree
server/plugins/
  └── my-plugin/
      ├── package.json
      └── index.ts
```

### package.json

```json
{
  "name": "<package name>?", // 此项可选, 默认使用目录名
  "main": "index.ts",
  "link-with": ["<web path>"],
  "enabled": true, // 此项可选, 默认为 true
  "commandName": "<command name>?" // 此项可选, 用于占用一级命令
}
```

```json
{
  "name": "my-plugin",
  "main": "index.ts",
  "link-with": ["https://example.com"],
  "enabled": true,
  "commandName": "my-command"
}
```

### 主模块导出

`index.ts`

```ts
export default async function (
  options: {
    writeData: (dirPath: string, data: any) => boolean;
    data?: any;
    site: {
      url: string;
      rootUrl: string;
      origin: string;
      pathname: string;
    };
  },
  log: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  },
): Promise<void> {
  // 这里编写你的处理逻辑
  log.info('插件已加载');
  if (options.data) {
    // 例如，将数据写入指定路径
    options.writeData('./data', options.data);
    log.info('数据已写入');
  }
}
```

> [!TIP]
>
> `writeData(dirPath, data)` 是服务端提供的工具函数，用于将数据写入指定路径的 `data.json` 文件和 `images` 文件夹。
>
> - `path`：文件夹路径（绝对路径）。
> - `data`：要写入的数据, 可以直接将 data 传入, 或经过某些处理后再传入。
>
> 如果文件不存在，则会自动创建。
>
> 如果文件存在，但根元素不是数组(包括空文件)，则不会写入。但浏览器控制台会认为已经传输到本地。
>
> 返回值为 `boolean`，表示写入是否成功。

### 插件加载

服务端启动时会自动扫描 `server/plugins/` 目录，加载所有插件。每个插件根据 `link-with` 字段指定的 URL 匹配规则，自动关联到对应网站。当网页端上传数据时，服务端会根据请求的 URL 匹配合适的插件并调用其主模块进行处理，无需手动引入或注册插件。
