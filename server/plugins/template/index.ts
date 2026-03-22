const template: SCWC.IPluginHandler['onRequest'] = (
  { utils: { writeData, writeDataURL, strValidation, convertToCN }, data, site },
  logger,
) => {
  logger.info('Template plugin called');
};

export default {
  name: 'template',
  onLoad: log => {},
  onRequest: template,
  onUnload: log => {},
} as SCWC.IPluginHandler;
