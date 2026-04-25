import { createLogger } from "../utils/log";
import path from "node:path";

const __dirname = process.cwd();

// 系统日志实例
export const serverLogger = createLogger('server', path.relative(process.cwd(), __dirname));
