export interface TLogger {
  info: (...args: Parameters<Console['info']>) => void;
  pathInfo: (...args: Parameters<Console['info']>) => void;
  warn: (...args: Parameters<Console['warn']>) => void;
  error: (...args: Parameters<Console['error']>) => void;
}
