/**
 * Babel config for native.
 *
 * `jsxImportSource: "nativewind"` makes `className` work on every React Native
 * primitive (View, Text, Pressable, …) without per-component wrappers.
 *
 * `nativewind/babel` runs the CSS-to-StyleSheet transform and also registers
 * `react-native-worklets/plugin` (Reanimated 4). babel-preset-expo would add
 * the same plugin a second time when react-native-worklets is installed, so
 * its copy is switched off with `reanimated: false`; the worklets plugin then
 * runs exactly once (audit N13, pinned by __tests__/config.test.ts).
 */
module.exports = function (api) {
  api.cache(true);

  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind", reanimated: false }], "nativewind/babel"],
  };
};
