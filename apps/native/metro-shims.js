const path = require("node:path");

/**
 * Optional native peers of our libraries that orrn does not link, mapped to JS
 * stand-ins in lib/shims/. With bun's isolated installs their JS is still
 * resolvable from the library's own folder, but the native module is missing,
 * and Metro reports a module that throws while loading (outside its start-up
 * guard) as a fatal error even when the importer catches it. Remove an entry
 * if the package ever becomes a real dependency (__tests__/native-shims.test.ts).
 */
const SHIMS = {
  // @better-auth/expo: refetch the session when the network comes back.
  "expo-network": path.join(__dirname, "lib", "shims", "expo-network.ts"),
};

/** Wrap a Metro config so SHIMS resolve to their stand-ins; everything else is unchanged. */
function withNativeShims(config) {
  const upstream = config.resolver && config.resolver.resolveRequest;
  return {
    ...config,
    resolver: {
      ...config.resolver,
      resolveRequest(context, moduleName, platform) {
        const shim = SHIMS[moduleName];
        if (shim) return { type: "sourceFile", filePath: shim };
        return (upstream || context.resolveRequest)(context, moduleName, platform);
      },
    },
  };
}

module.exports = { SHIMS, withNativeShims };
