import updateLocalStorage from '../../shared/utils/updateLocalStorage.ts';
import { defaultSiteData } from '../../shared/userscript-config.ts';
import { CONFIG_KEY } from '../../shared/utils/common.ts';
// 必须在 ConfigController / 浮窗读取并补齐旧键之前迁移，避免把默认值当作用户修改。
export const config = defaultSiteData().config;
config.api.host = import.meta.env.HOST ?? config.api.host;
config.api.port = import.meta.env.PORT ?? config.api.port;
const snapshot = updateLocalStorage(config);
localStorage.setItem(CONFIG_KEY, JSON.stringify(snapshot.data.config));
