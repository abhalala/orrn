const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const { wrapWithReanimatedMetroConfig } = require("react-native-reanimated/metro-config");

const { withNativeShims } = require("./metro-shims");

/** @type {import('expo/metro-config').MetroConfig} */
const config = withNativeShims(getDefaultConfig(__dirname));

module.exports = withNativeWind(wrapWithReanimatedMetroConfig(config), {
  input: "./global.css",
});
