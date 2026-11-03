import { scripts } from './script-ui.ts';
import {
  registerDeclarativeDemo,
  unloadDeclarativeDemo,
  declarativeApis,
} from './declarative-ui.ts';
import {
  configuration,
  loadConfiguration,
  unloadConfiguration,
  configurationApis,
} from './configuration.ts';
import {
  loadValidation,
  unloadValidation,
  validationApis,
  validationResources,
  validationSockets,
} from './validation.ts';

export default {
  // 插件名称, 目前可选. 建议和 package.json 中的 name 字段保持一致
  name: 'template',
  configuration,
  // 启动服务时调用, 可选, 支持异步
  // workbench.logger / workbench.tasks 由宿主注入，可长期持有，勿与调用级 context.tasks 混淆。
  onLoad: async (_logger, { workbench, config }) => {
    loadConfiguration(config);
    loadValidation(workbench);
    await registerDeclarativeDemo(workbench.ui);
  },
  // 每次接收到抓取请求时调用, 必选, 支持异步
  onRequest: async (
    { utils: { writeData, writeDataURL, strValidation, convertToCN, fetchImage }, data, site },
    logger,
  ) => {
    // 在后端打印日志
    logger.info('Template plugin called');
    // 向前端发送消息
    logger.toWeb('Send message to web', 'info');
  },
  // 卸载插件时调用, 例如服务停止或重启时, 可选, 支持异步
  onUnload: async () => {
    await unloadDeclarativeDemo();
    unloadConfiguration();
    await unloadValidation();
  },
  // 插件配置, 可选
  pluginConfig: {
    // 插件命令, 可选. 可以在这里定义一些插件相关的命令, 供用户在控制台输入执行
    command: {
      // 根执行函数, 可选, 支持异步. 在调用未注册的子命令时执行
      execute: async (logger, option) => {},
      // 命令描述, 可选
      description: '这是一个示例插件, 没有实际功能',
      // 子命令, 可选. 可以定义多个子命令, 每个子命令都有自己的执行函数和描述
      subCommands: [
        // 示例子命令. 当用户输入 "template sub-cmd" 时执行
        {
          name: 'sub-cmd',
          description: '这是子命令1',
          execute: async (logger, option) => {
            logger.info('执行了子命令1');
          },
        },
      ],
      // 命令选项, 可选. 定义一些命令行选项, 例如 "template --option1=value1 --option2=value2"
      options: [
        {
          name: 'option1', // 选项名称, 例如 "option1" 对应 "--option1"
          alias: 'o', // 选项别名, 可选. 例如 "o" 对应 "-o"
          description: '这是选项1', // 选项描述, 可选
          required: false, // 是否必填, 可选. 默认为 false
          defaultValue: 'default1', // 默认值, 默认为 undefined, 可选. 当用户未提供该选项时使用
        },
      ],
      // 命令示例用法, 可选. 例如 "template sub-cmd --option1=value1"
      exampleUsage: 'template sub-cmd --option1=value1',
    },
    // 脚本与扩展共用的 v2 JSON 配置及后端事件处理器。
    scripts,
  },
  // 由插件提供的浏览器界面, 可选. 如果插件不需要提供浏览器界面, 可以不配置这个字段
  ui: {
    // 浏览器界面的入口文件
    // 源码在 web/；HTML 缺失时核心按 build:web 自动构建，已有产物需主动重建。
    entry: './web/dist/index.html',
    // 浏览器界面的 API 接口, 可选. 可以在这里定义一些插件相关的 API 接口, 供浏览器界面通过 scwcutils.fetch 调用
    api: [
      ...declarativeApis,
      ...configurationApis,
      ...validationApis,
      {
        method: 'GET',
        path: '/api/test',
        handler: async (data, context) => {
          return 'Hello from local-watch-list plugin!';
        },
      },
    ],
    resources: [
      ...validationResources,
      // 资源接口, 可选. 支持流式传输. 可以在这里定义一些插件相关的资源接口, 供浏览器界面通过 scwcutils.resource 调用. 例如返回 { kind: 'file', path: absolutePath } 提供静态文件, 图片, 视频等
      {
        method: 'GET',
        path: '/static/css/main.css',
        handler: async () => ({ kind: 'response', status: 404, body: 'Resource not configured' }),
      },
    ],
    websocket: validationSockets,
  },
} satisfies SCWC.IPluginHandler;
