export default {
  // 插件名称, 目前可选. 建议和 package.json 中的 name 字段保持一致
  name: 'template',
  // 启动服务时调用, 可选, 支持异步
  onLoad: async (logger, { createRetryGet, LimitPromise }) => {},
  // 每次接收到抓取请求时调用, 必选, 支持异步
  onRequest: async (
    { utils: { writeData, writeDataURL, strValidation, convertToCN, fetchImage }, data, site },
    logger,
  ) => {
    logger.info('Template plugin called');
  },
  // 卸载插件时调用, 例如服务停止或重启时, 可选, 支持异步
  onUnload: async (logger, { isRestart }) => {},
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
    // 用于动态加载到浏览器脚本中的控制脚本, 可选.
    // 这些脚本会在浏览器脚本打开插件界面时加载, 可以在其中定义一些交互逻辑, 例如按钮点击事件等.
    scripts: {
      title: '示例脚本', // 脚本标题. 在浏览器脚本的插件界面显示
      description: '这是一个示例脚本, 没有实际功能', // 脚本描述, 可选. 在浏览器脚本的插件界面显示
      controls: [
        // 示例插件项. 这些项会在浏览器脚本的插件界面显示, 用户可以点击这些项触发一些操作
        {
          type: 'button', // 插件项类型, 例如 "button" 表示按钮
          label: '示例按钮', // 插件项标签. 在浏览器脚本的插件界面显示
          channel: 'example-channel', // 通信频道. 当用户点击这个按钮时, 浏览器脚本会向插件发送一个消息, 消息的 channel 字段为这个值
          trigger: async (logger, context) => ({
            type: 'notification',
            data: {
              type: 'info',
              message: '你点击了示例按钮',
            },
          }), // 触发函数, 支持异步. 当接收到浏览器脚本发送的消息时, 如果消息的 channel 字段与这个值匹配, 就会调用这个函数. 函数接收两个参数: logger 用于记录日志, context 包含一些上下文信息, 例如用户输入的数据等
        },
      ],
    },
  },
} as SCWC.IPluginHandler;
