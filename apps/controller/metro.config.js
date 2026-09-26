const { getDefaultConfig } = require('expo/metro-config');
const { withNativewind } = require('nativewind/metro');

// Expo configures Metro for the npm workspace on its own (SDK 52+): no
// watchFolders or nodeModulesPaths here, or the old duplicate-react trap returns.
const config = getDefaultConfig(__dirname);

module.exports = withNativewind(config, { inlineRem: 16 });
