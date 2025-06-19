namespace SCWC {
  export interface Plugin {
    (
      options: {
        writeJson: (path: string, data: any) => boolean;
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
    ): void | Promise<void>;
  }
}
