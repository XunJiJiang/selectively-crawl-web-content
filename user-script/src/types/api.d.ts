export type TCrawlResult = {
  pluginInfo: {
    name: string;
  };
  info: string;
  type: "success" | "error" | "warn" | "info";
}[] | string[];

export type ResponseData<T = any> = {
  success: boolean;
  message: string;
  data?: T;
};

export type TCrawlResponse = ResponseData<TCrawlResult>;
