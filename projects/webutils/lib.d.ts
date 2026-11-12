type TSCWCUtils = import('./lib/index.ts').TSCWCUtils;

// 将此声明文件设为外部模块，以确保下方的全局扩展能一致地应用于每个 TypeScript 插件项目。
export {};

declare global {
  interface Window {
    scwcutils: TSCWCUtils;
  }
}
