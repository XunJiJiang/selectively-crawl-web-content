import { registerPluginSdk } from './register.ts';

const entry = process.env.SCWC_PLUGIN_WORKER_ENTRY;
delete process.env.SCWC_PLUGIN_WORKER_ENTRY;
if (!entry) {
  throw new Error('缺少插件 Worker 入口');
}
registerPluginSdk();
void import(entry).catch((error: unknown) => {
  // Surface initialization/import failures through the Worker's error event.
  setImmediate(() => {
    throw error;
  });
});
