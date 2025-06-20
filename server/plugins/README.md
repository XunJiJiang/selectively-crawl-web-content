# 插件

## 插件开发说明

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

### 主模块导出

> [!TIP]
>
> `data` 类型参考 [数据结构](#5. 保存的数据结构)

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

> [!TIP]
>
> `writeData(dirPath, data)` 是服务端提供的工具函数，用于将数据写入指定路径的 `data.json` 文件和 `images` 文件夹。
>
> - `path`：文件夹路径（绝对路径）。
>
> - `data`：要写入的数据, 可以直接将 data 传入, 或经过某些处理后再传入。
>
> 如果文件不存在，则会自动创建。
>
> 如果文件存在，但根元素不是数组(包括空文件)，则不会写入。但浏览器控制台会认为已经传输到本地。
>
> 返回值为 `boolean`，表示写入是否成功。

### 插件加载

服务端启动时会自动扫描 `server/plugins/` 目录，加载所有插件。每个插件根据 `link-with` 字段指定的 URL 匹配规则，自动关联到对应网站。当网页端上传数据时，服务端会根据请求的 URL 匹配合适的插件并调用其主模块进行处理，无需手动引入或注册插件。
