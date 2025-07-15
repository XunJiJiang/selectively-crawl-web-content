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
- 抓取结果通过 POST 上传本地 Node 服务。
- 通过插件自定义指定网站的数据操作。

## 快速使用

> [!NOTE]
>
> 建议使用支持直接运行 ts 的环境，例如 `bun`、`node v24+` 等，此时可以直接运行服务和 ts 插件
>
> 否则，必须手动编译为 js

### 安装依赖

> ![NOTE]
>
> 项目使用 bun 进行包管理, 使用 node tsx 运行服务端

```bash
bun i
```

### 启动服务端

1. 编写 [插件](#插件)

2. 启动服务：

```bash
npm run dev
```

> [!TIP]
> 服务默认监听 <http://localhost:3100>
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

- 打开任意网页，左上角出现悬浮窗。
- 点击“选择”按钮，高亮光标定位的元素，点击选中元素。
- 填写描述，点击“确认”加入表单。
- 加入表单后，可修改前缀，例如修改为 `#`。
- 支持多项管理、拖拽排序、删除。
- 点击“抓取”按钮，内容将上传到本地服务端。

### 获取的数据结构

```ts
type DataItem = {
  label: string;
  value: string;
  images: string[]; // dataURL
};

type DataType = DataItem[];

const data: DataType;
```

> [!TIP]
>
> 主程序为插件提供了一种处理 `DataItem[]` 和 `dataURL` 的方法。
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

插件用于自定义不同网站的数据处理逻辑，需放置于 `server/plugins/` 目录下，支持 TypeScript/JavaScript。

#### 插件结构

每个插件为一个独立的包目录，需包含 `package.json` 和主模块文件（如 `index.ts`）。

**示例目录结构：**

```tree
server/plugins/
  └── my-plugin/
      ├── package.json
      └── index.ts
```

#### package.json

```json
{
  "name": "<package name>?", // 此项可选
  "module": "index.ts",
  "link-with": ["<web path>"]
}
```

```json
{
  "name": "my-plugin",
  "module": "index.ts",
  "link-with": ["https://example.com"]
}
```

#### 主模块导出

> [!TIP]
>
> `data` 类型参考 [数据结构](#获取的数据结构)

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
  }
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

<a name="about-writeData-writeDataURL"></a>

> [!TIP]
>
> `writeData` 和 `writeDataURL` 是服务端提供的工具函数。
>
> `writeData(dirPath, data)` 用于将数据写入指定路径的 `data.json` 文件和 `images` 文件夹。
>
> - `path`：文件夹路径（绝对路径）。
> - `data`：要写入的数据, 可以直接将 data 传入, 或经过某些处理后再传入。
>   如果文件不存在，则会自动创建。
>   如果文件存在，但根元素不是数组(包括空文件)，则不会写入。但浏览器控制台会认为已经传输到本地。
>
> 返回值为 `boolean`，表示写入是否成功。
>
> `writeDataURL(dataUrl, filePath)` 用于将 base64 编码的图片 dataURL 转换为图片文件并保存到指定目录。
>
> - `dataUrl`：base64 编码的 dataURL 字符串。
> - `filePath`：可以是保存目录（字符串），也可以是一个函数（接收参数包括完整文件名、文件名、扩展名、日期前缀，返回最终保存路径）。
>
> 返回值：成功时返回保存的文件路径，失败时返回 false。

#### 插件加载

服务端启动时会自动扫描 `server/plugins/` 目录，加载所有插件。每个插件根据 `link-with` 字段指定的 URL 匹配规则，自动关联到对应网站。当网页端上传数据时，服务端会根据请求的 URL 匹配合适的插件并调用其主模块进行处理，无需手动引入或注册插件。

## 常见问题

- **端口冲突**：如默认的 3100 端口被占用，可修改 .env 中 `PORT`。

## 开发&自定义

- 脚本源码：`user-script/src/`，基于 React+Vite。
- 服务端源码：`server/index.ts`，基于 Express。
- 构建命令、依赖见 `package.json`。

## 贡献&反馈

如有建议、bug 或新需求，欢迎发起 issue。

## 免责声明

本项目仅供学习与技术交流使用，严禁用于任何违反法律法规或侵犯他人权益的用途。因使用本项目产生的任何后果，均由使用者本人承担，作者不承担任何法律责任。

## License

项目采用 [MIT License](./LICENSE) 开源许可，详情请查阅 LICENSE 文件。
