import { registerHooks } from 'node:module';

// 仅供集成测试及其子进程：阻止真实 .env 覆盖临时数据库路径、TOKEN 或 Redis 开关。
// 不改核心文件，也不让测试触碰工作区现有数据库、缓存与插件启用配置。
const environment = new URL('../../../common/environment.ts', import.meta.url).href;
registerHooks({
  load(url, context, next) {
    if (url === environment)
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export function loadEnvironment() {}',
      };
    return next(url, context);
  },
});
