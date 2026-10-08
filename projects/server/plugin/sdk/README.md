# 插件共享 SDK

业务插件与终端插件的宿主在动态导入插件前注册同步 Node 模块钩子，提供 `scwc:deps` 和 `scwc:runtime` 两个虚拟 ESM 模块。无需发布或安装同名 npm 包；源码与 SEA 使用相同契约，插件目录无需位于核心项目内。

## 共享依赖

```ts
import { axios, z, Database, trash, fileTypeFromFile } from 'scwc:deps';
import type { AxiosRequestConfig, FileTypeResult } from 'scwc:deps';
```

当前明确提供 Axios（`axios`、`AxiosError`、`AxiosHeaders`）、Chalk（`chalk`）、Zod（`z`）、better-sqlite3（`Database`）、Trash（`trash`）、File Type（`fileType` 命名空间及 `fileTypeFromFile/Buffer/Stream`）。版本使用核心锁定的依赖版本；根 package.json 中其他依赖不会自动开放。普通包名导入继续走 Node 默认解析，不会自动转到 SDK。需要不同版本时由插件提供私有依赖。

纯 JS 依赖合并进宿主 bundle。SQLite 原生包、Trash 的系统工具及传递依赖作为 SEA assets 保留原目录，在核心私有临时目录释放；不会安装到业务插件目录。二进制使用构建目标的平台和运行时版本。释放资源在 Unix 上保留权限。

## 插件 Worker 与 RPC

```ts
import { createPluginWorker, RpcPeer, PluginProcessError } from 'scwc:runtime';
import type { PluginRequest, PluginWorkerOptions } from 'scwc:runtime';

const worker = createPluginWorker(new URL('./worker.ts', import.meta.url), {
  workerData: { mode: 'reader' },
});
```

同步模块钩子不自动继承到 Worker。该工厂先运行核心引导文件，注册 SDK，再动态导入真实入口；保留 workerData、transferList 和其他 Worker 选项。入口必须是 file: URL；不支持 eval 或 SHARE_ENV。每个 Worker/进程有独立依赖实例，不通过 IPC 传递函数。直接创建 Worker、另起 Node 子进程或直接运行插件时，需要先自行注册 `registerPluginSdk()`；核心源码入口位于 register.ts。

## 开发类型

模板 tsconfig 的 files 同时包含 `../plugin-env.d.ts` 和 `../../plugin/sdk/modules.d.ts`。前者提供 SCWC 契约，后者声明虚拟模块，复用原包类型与核心 RPC/Worker 类型，包括 `z.infer`、`Database.Database` 和 Axios 泛型。

独立目录开发可以在 tsconfig.files 中显式指定核心工作区内这两份文件的路径。核心工作区须安装其依赖，以解析声明中引用的原包类型及传递类型；插件无需重复安装共享包。当前 SDK 类型按源码布局提供，没有生成脱离源码的独立类型发行包，也不会从可执行文件还原声明。

## 浏览器和测试

`scwc:deps` 默认属于 Node 宿主。前后端共用 Zod 模型时，Vite 的 alias 可指向 browser.ts；该适配只导出 `z`，不会把 Node 或原生包打进页面。独立插件的页面构建同样需要配置此别名。

Vitest 使用 server/vitest.config.ts 中的别名分别映射到 dependencies.ts 与 runtime.ts；这是测试解析配置，不替代原生 Node 钩子验证。

```bash
bun run test --run projects/server/plugin/sdk
bun run build:core
# 存在 dist/core/scwc(.exe) 后，以下命令包含真实 SEA 外部贴纸验证。
bun run test --run projects/server/plugin/sdk/executable-sdk.test.ts
```

SDK 测试覆盖外部目录无共享 node_modules、ESM/CJS、原生 SQLite、Worker、普通相对导入、类型检查，以及真实贴纸插件的读写 Worker 和 API。真实贴纸验证只复制插件源码、资源及私有后端依赖，数据全部使用临时目录；未安装贴纸或尚未构建可执行文件时跳过相应集成项。
