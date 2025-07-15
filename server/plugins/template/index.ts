const template: SCWC.PluginHandler['onRequest'] = (
  { utils: { writeData, writeDataURL, strValidation, convertToCN }, data, site },
  log
) => {
  log.info('Template plugin called');
};

export default {
  onLoad: log => {},
  onRequest: template,
  onUnload: log => {},
} as SCWC.PluginHandler;
