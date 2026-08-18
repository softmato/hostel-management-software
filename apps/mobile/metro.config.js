const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

/*
 * Redirect `@react-native-community/netinfo` to a JS-only shim.
 *
 * `pusher-js/react-native` imports it at module load — see `src/shims/netinfo.js`
 * for what it reads and why the shim answers the way it does. Installing netinfo
 * for real would take the whole app out of Expo Go, which is a heavy price for a
 * reachability hint Pusher's own reconnect logic does not need.
 *
 * Same approach the reference app (`D:\Jiwan-Mijhar\app`) settled on. Delete this
 * block if netinfo is ever installed for real.
 */
const netinfoShim = path.resolve(__dirname, "src/shims/netinfo.js");
const baseResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@react-native-community/netinfo") {
    return { filePath: netinfoShim, type: "sourceFile" };
  }

  return typeof baseResolveRequest === "function"
    ? baseResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./src/global.css" });
