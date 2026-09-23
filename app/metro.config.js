const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const msalBrowser = path.resolve(__dirname, 'node_modules/@azure/msal-common/dist-browser/index-browser.mjs');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === '@azure/msal-common/browser') {
    return { type: 'sourceFile', filePath: msalBrowser };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
