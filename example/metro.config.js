const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// The module is `file:..`, a symlink to the folder above the app: Metro must watch it,
// and its imports (react, react-native, expo-modules-core) resolve from this app's node_modules.
config.watchFolders = [path.resolve(__dirname, "..")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = config;
