namespace SCWC {
  interface IContext {}

  export type TCommandExecute = import('../utils/command').TCommandExecute;
  export type TCommandOption = import('../utils/command').TCommandOption;
  export type TSubCommand = import('../utils/command').TSubCommand;

  export type DataItem = {
    label: string;
    value: string;
    images: string[]; // 图片数据，dataURL
  };

  export type PluginItem = {
    type: 'button' | 'toggle' | 'select' | 'input:text' | 'input:number' | 'checkbox';
    label: string;
    channel: string;
    options?: {
      label: string;
      value: string;
    }[];
    trigger: (
      log: SCWC.Log,
      context: {
        data: DataItem[];
        site: {
          url: string;
          rootUrl: string;
          origin: string;
          pathname: string;
        };
      },
    ) =>
      | {
          type: 'notification';
          data: {
            type: 'success' | 'error' | 'warn' | 'info';
            message: string;
          };
        }
      | Promise<{
          type: 'notification';
          data: {
            type: 'success' | 'error' | 'warn' | 'info';
            message: string;
          };
        }>;
  };

  export type Log = {
    info: (...args: any[]) => void;
    pathInfo: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };

  export interface PluginHandler {
    name: string;
    onLoad?: (log: Log, context: IContext) => Promise<void>;
    onRequest: (
      options: {
        utils: {
          strValidation: (str: string) => string;
          convertToCN: (str: string) => string;
          fetchImage: (url: string) => Promise<Buffer | null>;
          writeData: <D>(path: string, data: D) => Promise<false | { data: D }>;
          /**
           * 处理 dataURL
           * 将其转换为图片文件并保存到指定目录
           * @param dataUrl base64编码的dataURL字符串
           * @param filePath 保存路径或函数
           * 如果是函数, 接收一个对象参数, 包含以下字段:
           * - fullname: 完整文件名, 包含扩展名
           * - filename: 不包含扩展名的文件名
           * - ext: 文件扩展名
           * - datePrefix: 日期前缀, 格式为 YYYYMMDDHHmmss
           * - 返回值为最终保存的文件路径
           * @returns 如果成功, 返回保存的文件路径; 如果失败, 返回 false
           */
          writeDataURL: (
            dataUrl: string,
            filePath:
              | string
              | ((props: { fullname: string; filename: string; ext: string; datePrefix: string }) => string),
          ) => Promise<string | false>;
        };
        data: DataItem[];
        site: {
          url: string;
          rootUrl: string;
          origin: string;
          pathname: string;
        };
      },
      log: Log & {
        toWeb: (info: string, type?: 'success' | 'error' | 'warn' | 'info') => void;
      },
    ) => void | Promise<void>;
    onUnload?: (log: Log) => Promise<void>;
    pluginConfig?: {
      command?: {
        execute: TCommandExecute;
        description?: string;
        subCommands?: TSubCommand[];
        options?: TCommandOption[];
        exampleUsage?: string;
      };
      scripts?: {
        title: string;
        description?: string;
        controls: PluginItem[];
      };
    };
  }

  export interface PluginMeta {
    name: string;
    entry: string;
    linkWith: string[];
    handler?: PluginHandler;
    pluginId: string;
    // 占用的一级命令
    commandName?: string;
    log: Log;
  }
}
