module.exports = function (api) {
  api.cache(true);

  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [
      // Must stay last — Reanimated's worklet transform has to see the final AST.
      "react-native-worklets/plugin",
    ],
  };
};
