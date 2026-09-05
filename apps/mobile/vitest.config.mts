import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

/**
 * Node-only tests for pure logic — route resolution, URL derivation, formatting.
 *
 * There is deliberately no React Native preset here. Rendering RN components
 * under vitest needs a heavy shim layer that tends to test the shim rather than
 * the app; component behaviour is verified on a device instead. What *is* worth
 * testing in isolation is the logic that decides things, and that logic is kept
 * free of RN imports so it can be.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(root, "./src"),
      /*
       * The platform's date rules, resolved to the same file the server
       * imports and Metro bundles — see `metro.config.js` for why the alias
       * points at the `calendar` directory rather than at `@hostel/shared`.
       * Aliasing it here too is what keeps these tests testing the shipped
       * conversion instead of a stand-in for it.
       */
      "@hostel/calendar": resolve(root, "../../packages/shared/src/calendar"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
