namespace SCWC {
  export type DataItem = {
    label: string;
    value: string;
    images: string[]; // 图片数据，dataURL
  };

  export interface Plugin {
    (
      options: {
        writeData: (path: string, data: any) => boolean;
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
        data: DataItem[];
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
    ): void | Promise<void>;
  }
}
