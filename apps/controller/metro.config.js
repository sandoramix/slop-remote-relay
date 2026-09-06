const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * Metro configuration, adjusted for the npm workspace.
 *
 * Two things differ from a standalone app. Metro has to watch the repository
 * root, or an edit to packages/protocol never reaches the bundle. And module
 * resolution has to be pinned to the two node_modules directories that exist,
 * because npm hoists to the root and symlinks back: left to walk the tree on its
 * own Metro finds react twice and the app dies on an invalid hook call that
 * points nowhere near the cause.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
