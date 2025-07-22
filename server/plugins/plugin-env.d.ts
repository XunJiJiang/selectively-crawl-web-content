namespace SCWC {
  export type DataItem = {
    label: string;
    value: string;
    images: string[]; // 图片数据，dataURL
  };

  export type Log = {
    info: (...args: any[]) => void;
    pathInfo: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };

  export interface PluginHandler {
    name: string;
    onLoad?: (log: Log) => void;
    onRequest: (
      options: {
        utils: {
          strValidation: (str: string) => string;
          convertToCN: (str: string) => string;
          fetchImage: (url: string) => Promise<Buffer | null>;
          writeData: <D>(path: string, data: D) => false | { data: D };
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
              | ((props: { fullname: string; filename: string; ext: string; datePrefix: string }) => string)
          ) => string | false;
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
        toWeb: (info: string, type?: 'success' | 'error') => void;
      }
    ) => void | Promise<void>;
    onUnload?: (log: Log) => void;
  }

  export interface PluginMeta {
    name: string;
    entry: string;
    linkWith: string[];
    handler?: PluginHandler;
  }
}
