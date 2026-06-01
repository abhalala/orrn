/**
 * Babel config for native.
 *
 * `jsxImportSource: "nativewind"` makes `className` work on every React Native
 * primitive (View, Text, Pressable, …) without per-component wrappers.
 *
 * `nativewind/babel` runs the CSS-to-StyleSheet transform.
 *
 * Reanimated's plugin MUST stay last per its docs.
 */
module.exports = function (api) {
  api.cache(true);

  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }], "nativewind/babel"],
    plugins: ["react-native-reanimated/plugin"],
  };
};
