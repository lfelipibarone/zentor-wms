// Expo SDK 52+ configures Metro for monorepos automatically via expo/metro-config.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
