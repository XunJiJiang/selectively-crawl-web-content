export type TLogger = {
  info: (...args: any[]) => void;
  pathInfo: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
};