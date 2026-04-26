# selectively-crawl-web-content

## 简介

用于选择性抓取网页内容，由前端油猴脚本（React/Vite/TypeScript）和 Node 服务端（Express）组成。支持在任意网页上通过悬浮窗选择、管理、抓取页面元素内容，并将结果上传到本地服务器。

> [!WARNING]
>
> 一些网站禁止了向可能违反安全策略的地址（例如 `localhost`）发送请求
>
> 本项目不支持也不推荐在这类网站上使用

## 功能

- 油猴脚本悬浮窗，支持拖动、收起、展开、位置记忆。
- 元素选择与高亮。
- 每项可设置“前缀”。
- 抓取结果发送到本地 Node 服务。
- 通过插件自定义指定网站的数据操作。

## 快速使用

> [!NOTE]
>
> 建议使用支持直接运行 ts 的环境，例如 `bun`、`node v24+` 等，此时可以直接运行服务和 ts 插件
>
> 否则，必须手动编译为 js

### 安装依赖

> [!NOTE]
>
> 建议使用 bun 进行包管理, 使用 node tsx 运行服务端

```bash
bun install
```

另外，对于部分用到了缓存的插件，需要安装并启动 redis 服务。

### 启动服务端

1. 编写 [插件](#插件)

2. 启动服务：

```bash
npm run start
```

> [!TIP]
> 服务默认监听 <http://localhost:3200>
>
> 可通过配置 `.env` 中的 `PORT` 修改

### 构建并安装油猴脚本

1. 构建脚本：

   ```bash
   bun run build
   # 生成 dist/vite-project.user.js
   ```

2. 在油猴/Violentmonkey/GreaseMonkey 中新建脚本，粘贴 `dist/vite-project.user.js` 内容。

### 网页端使用

- 打开任意网页，左上角出现 SCWC 字样的左侧贴边悬浮窗, 此时为收起状态
- 点击悬浮窗展开表单区 (在未展开状态下, 拖动悬浮窗可以在纵向范围内调整位置)
- 点击“选择”按钮，高亮光标定位的元素，点击选中元素
- 填写描述，点击“确认”加入表单
- 加入表单后，可修改前缀，例如修改为 `#`
- 支持多项管理、拖拽排序、删除
- 点击“抓取”按钮，内容将上传到本地服务端
- 点击悬浮窗右上角 "-" 按钮收起表单区
- 点击右上角箭头按钮展开插件区, 查看插件提供的操作, 再次点击箭头按钮收起插件区

### 获取的数据结构

点击“抓取”按钮后，服务端会接收到一个包含所有表单项的数组，每个项包含标签、值和图片数据（如果框选中的元素存在图片标签）。数据结构如下：

```ts
type DataItem = {
  label: string;
  value: string;
  images: string[]; // dataURL (或图片链接，部分网站不支持将地址跨域的图片转为 dataURL)
};

type DataType = DataItem[];

const data: DataType;
```

> [!TIP]
>
> 主程序为插件提供了一种处理 `DataItem[]` 和 `dataURL` (或图片链接) 的方法。
>
> 处理方法看[这里](#about-writeData-writeDataURL)。

#### 数据结构举例

假设你在网页上抓取两个个元素：

```html
<h1>我是标题</h1>

<div>我是标签<span>猫</span><span>狗</span></div>
```

设置第一个元素标签为空(会默认设置为`<null>`)，前置为空；

设置第二个元素标签为`标签`，前置为 `@`；

则服务端接收到的数据如下：

```ts
const data = [
  { label: '<null>', value: '我是标题', images: [] },
  { label: '标签', value: '@我是标签 @猫 @狗', images: [] },
];
```

每次点击“抓取”按钮，都会将当前表单区所有项作为一个数组整体追加到文件，形成二维数组结构。

> [!WARNING]
>
> 注意，选择的元素会在向服务端发送请求时进行扁平化处理，并为每一段文本元素前都添加前置

## 插件

### 插件开发说明

插件用于在服务端自定义针对不同网站的数据处理逻辑。将插件放到 `server/plugins/` 目录下（支持 TypeScript/JavaScript），服务在启动时会自动扫描并加载。插件必须默认导出一个符合 `SCWC.IPluginHandler` 类型的对象（参考 `server/plugins/plugin-env.d.ts` 与 `server/plugins/template/index.ts` 示例）。

#### 插件目录结构

每个插件为一个独立目录，需包含 `package.json` 与主模块（通常为 `index.ts` 或 `index.js`）。

示例：

```txt
server/plugins/
  └── my-plugin/
      ├── package.json
      └── index.ts
```

#### package.json

package.json 中至少需要包含 `main` 字段指定主模块路径，建议添加 `name` 字段与插件目录名一致。还需添加 `link-with` 字段指定插件关联的网站 URL（支持字符串或正则表达式）。

```json
{
  "name": "<package name>?", // 此项可选, 默认使用目录名
  "main": "index.ts",
  "link-with": ["<web path>"],
  "enabled": true, // 此项可选, 默认为 true
  "commandName": "<command name>?" // 此项可选, 用于占用一级命令
}
```

示例：

```json
{
  "name": "my-plugin",
  "main": "index.ts",
  "link-with": ["https://example.com"],
  "enabled": true,
  "commandName": "my-command"
}
```

#### 主模块导出方式

参见仓库中的示例插件 [server/plugins/template/index.ts](server/plugins/template/index.ts)。插件应导出一个对象，常见字段包括：`name`、`onLoad`、`onRequest`、`onUnload` 和 `pluginConfig`。示例：

```ts
export default {
  name: 'template',
  onLoad: async (logger, { createRetryGet, LimitPromise }) => {
    // 可选：服务启动或插件热加载时调用
  },
  onRequest: async (
    { utils: { writeData, writeDataURL, strValidation, convertToCN, fetchImage }, data, site },
    logger,
  ) => {
    // 必选：每次接收到抓取请求时调用
    logger.info('Template plugin called');
  },
  onUnload: async (logger, { isRestart }) => {
    // 可选：服务停止或重启时调用
  },
  pluginConfig: {
    command: {
      execute: async (logger, option) => {},
      description: '示例命令',
      subCommands: [
        {
          name: 'sub-cmd',
          description: '示例子命令',
          execute: async (logger, option) => {
            logger.info('执行了子命令1');
          },
        },
      ],
      options: [
        {
          name: 'option1',
          alias: 'o',
          description: '这是选项1',
          required: false,
          defaultValue: 'default1',
        },
      ],
      exampleUsage: 'template sub-cmd --option1=value1',
    },
    scripts: {
      title: '示例脚本',
      description: '在浏览器端加载的控制脚本元数据',
      controls: [
        {
          type: 'button',
          label: '示例按钮',
          channel: 'example-channel',
          trigger: async (logger, context) => ({
            type: 'notification',
            data: { type: 'info', message: '你点击了示例按钮' },
          }),
        },
      ],
    },
  },
} as SCWC.IPluginHandler;
```

注意：以上示例严格参考 `server/plugins/template/index.ts` 的导出形式；请以该示例与类型声明 `server/plugins/plugin-env.d.ts` 为准，不要依赖其他未明示的字段或行为。

#### onLoad / onUnload

`onLoad(logger, context)`：可选，在插件加载或服务启动时调用，支持异步。`context`（若有）由主程序传入，类型定义见 `plugin-env.d.ts`。

`onLoad` 中提供的 `context` 包含 `createRetryGet` 和 `LimitPromise` 两个工具：

> [!TIP]
> `onLoad` 中提供的 `context` 的内容允许插件长期持有，并在需要时任意调用

- `createRetryGet(createRetryRequestClass: (RetryRequest) => RetryRequest)`：允许自定义义重试请求类以更灵活的获取需要的数据。
- `LimitPromise`：一个用于限制并发请求数量的 Promise 工具。

`onUnload(logger, context)`：可选，在插件卸载或服务重启时调用，支持异步。`context` 中包含是否重启等信息。

`onUnload` 中提供的 `context` 包含 `isRestart` 字段，表示当前卸载是否由服务重启引起。插件可以根据这个信息决定是否需要清理某些资源或状态。

#### onRequest（核心）

`onRequest` 是插件处理抓取数据时必须实现的函数。其签名为：

- 参数1（`context`）包括：
  - `utils`：一组工具函数（详见下文），例如 `writeData`、`writeDataURL`、`fetchImage`、`strValidation`、`convertToCN` 等；
  - `data`：来自浏览器端的 `SCWC.TDataItem[]`（参见“获取的数据结构”）；
  - `site`：包含 `url`、`rootUrl`、`origin`、`pathname`
- 参数2（`logger`）为日志记录器；当 `onRequest` 被调用时，`logger` 还包含 `toWeb(info, type?)` 方法用于向浏览器端发送通知（见 `plugin-env.d.ts`）；当执行插件提供的控制器触发的操作时，`logger` 不包含 `toWeb` 方法，而是必须返回一个带有消息的对象。

<a name="about-writeData-writeDataURL"></a>

示例：

```ts
onRequest: async ({ utils: { writeData, writeDataURL }, data, site }, logger) => {
  logger.info('收到数据', site.url);
  // 使用 writeData 写入数据并使用 writeDataURL 保存 dataURL 图片
  const saveResult = await writeData('path/to/my-data', data);
};
```

#### 可用工具（由主程序注入）

以下为 `onRequest` 中 `context.utils` 中常见工具的实际签名（以 `server/plugins/plugin-env.d.ts` 为准）：

- `writeData: <D>(path: string, data: D) => Promise<false | { data: D }>`：将数据写入指定目录下的 `data.json` 与 `images` 文件夹，返回写入结果或 `false`。
- `writeDataURL: (dataUrl: string, filePath: string | ((props: { fullname: string; filename: string; ext: string; datePrefix: string }) => string)) => Promise<string | false>`：将 dataURL 或图片链接保存为文件，成功返回保存的路径，失败返回 `false`。
- `fetchImage: (url: string) => Promise<Buffer | null>`：抓取图片并返回 Buffer 或 `null`。
- `strValidation`、`convertToCN` 等是字符串处理辅助函数。
- `convertToCN`：将繁体中文和日文汉字转换为简体中文，其他字符保持不变。

详细类型与说明请参见 `server/plugins/plugin-env.d.ts`，以避免对行为的错误推测。

#### 插件加载

服务端启动时会自动扫描 `server/plugins/` 目录，加载所有插件。每个插件根据 `link-with` 字段指定的 URL 匹配规则，自动关联到对应网站。当网页端上传数据时，服务端会根据请求的 URL 匹配合适的插件并调用其主模块进行处理，无需手动引入或注册插件。

## 常见问题

- **端口冲突**：如默认的 3200 端口被占用，可修改 .env 中 `PORT`。浏览器脚本也支持切换端口，但是目前需要手动修改浏览器本地存储空间中的 `__selective_crawl_config__` 对象中的 `port` 字段。

## 开发&自定义

- 浏览器脚本源码：`user-script/src/`，基于 TypeScript+Vite+React。
- 服务端源码：`server/index.ts`，基于 TypeScript+Express
- 构建命令、依赖见根目录中的 `package.json`。

### 注意

想要在服务端主进程或浏览器脚本中添加新的库时, 建议将库添加到根目录的 `package.json` 中;

如果要在插件中使用新的库, 建议在插件目录下单独安装.

不建议将库安装在服务端或浏览器脚本所在的文件夹中.

## TODO

- [ ] 添加浏览脚本部分的设置界面, 允许用户设置一些选项, 例如服务端地址和端口, 以及一些功能开关等
- [ ] 重启命令
- [ ] log 文件日志
- [ ] 浏览器脚本在出现非请求信息时也显示弹窗提示
- [ ] 当捕获的元素在另一个页面不存在时，允许用户重新捕获对应元素并使用对比算法与之前的捕获进行比较计算出更可能的元素路径

- [x] 添加前后端权限验证
- [x] 插件可以设置哪些操作要求页面内容能够全部获取

## 贡献&反馈

如有建议、bug 或新需求，欢迎发起 issue。

## 免责声明

本项目仅供学习与技术交流使用，严禁用于任何违反法律法规或侵犯他人权益的用途。因使用本项目产生的任何后果，均由使用者本人承担，项目开发者不承担任何法律责任。

## License

项目采用 [MIT License](./LICENSE) 开源许可，详情请查阅 LICENSE 文件。
