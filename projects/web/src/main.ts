import '../../shared/components/index.ts';
import { ConfigController } from '../../shared/store/config.ts';
import { CONFIG_KEY } from '../../shared/utils/common.ts';
import { loadLocalConfig } from './api/local-config.ts';

async function main() {
  ConfigController.config = await loadLocalConfig(ConfigController.config);
  localStorage.setItem(CONFIG_KEY, JSON.stringify(ConfigController.config));
  // 先加载启动配置，再创建组件，确保首次 API 请求已携带当前 TOKEN。
  await import('./layouts/index.ts');
}

void main();
