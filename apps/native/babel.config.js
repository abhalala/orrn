module.exports = function (api) {
  api.cache(true);

  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "@tamagui/babel-plugin",
        {
          config: "../../packages/ui/src/tamagui.config.ts",
          components: ["tamagui", "@orrn/ui"],
        },
      ],
      "react-native-reanimated/plugin",
    ],
  };
};
