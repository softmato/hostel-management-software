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

/*
 * `@hostel/calendar/*` — the platform's date rules, compiled into the app from
 * the same file the server imports.
 *
 * The app is deliberately outside the npm workspace (Expo keeps its own
 * `node_modules`), so `@hostel/shared` does not resolve here and hoisting it
 * would drag the package's root entry point — which pulls in the mail sender and
 * its Node dependencies — into a phone bundle. This alias points at one
 * directory instead: `packages/shared/src/calendar`, whose only import is
 * `nepali-date-converter`, and which the app already depends on.
 *
 * The point of the alias is that there is no second copy. A month boundary the
 * server bills on and a month boundary the app draws have to be the same
 * boundary, and the way that stops being true is somebody maintaining two
 * implementations of it — which is exactly what produced a Bhadra label over
 * September's arithmetic.
 */
const calendarRoot = path.resolve(__dirname, "../../packages/shared/src/calendar");
const baseResolveRequest = config.resolver.resolveRequest;

config.watchFolders = [...(config.watchFolders ?? []), calendarRoot];

/*
 * And the one package that file imports, resolved from *this* app's tree.
 *
 * Metro resolves a bare specifier by walking up from the importing file, so
 * `bs.ts` looks in `packages/shared/node_modules` and then the repo root — and
 * the repo root is not a watch folder, so Metro will not read it however
 * installed the package is there. Adding the root to `watchFolders` would fix
 * the resolution by making Metro crawl every dependency of the web app and the
 * server on each start, which is a heavy price for one small library.
 *
 * `nepali-date-converter` is already a declared dependency of this app, so the
 * copy to bundle is the one beside it. `extraNodeModules` is Metro's documented
 * fallback for exactly this shape of monorepo import.
 */
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "nepali-date-converter": path.resolve(__dirname, "node_modules/nepali-date-converter"),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@react-native-community/netinfo") {
    return { filePath: netinfoShim, type: "sourceFile" };
  }

  if (moduleName.startsWith("@hostel/calendar/")) {
    return {
      filePath: path.join(calendarRoot, `${moduleName.slice("@hostel/calendar/".length)}.ts`),
      type: "sourceFile",
    };
  }

  return typeof baseResolveRequest === "function"
    ? baseResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./src/global.css" });
