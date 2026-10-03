/**
 * Babel config for native.
 *
 * `jsxImportSource: "nativewind"` makes `className` work on every React Native
 * primitive (View, Text, Pressable, …) without per-component wrappers.
 *
 * `nativewind/babel` runs the CSS-to-StyleSheet transform.
 *
 * No explicit reanimated/worklets plugin: babel-preset-expo adds the worklets
 * plugin itself when react-native-worklets is installed (it is), and listing
 * it a second time double-transforms every worklet (audit N13).
 */
module.exports = function (api) {
  api.cache(true);

  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
  };
};
