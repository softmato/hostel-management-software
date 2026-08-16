/// <reference types="nativewind/types" />
/// <reference types="expo/types" />

/**
 * `import "@/global.css"` is a Metro side-effect import — NativeWind's Babel
 * transform consumes it and nothing is emitted. TypeScript has no idea what a
 * `.css` module is, so declare it.
 *
 * This lives here rather than in `expo-env.d.ts` on purpose: the Expo CLI
 * regenerates that file and rewrites `tsconfig.json#include`, which silently
 * dropped this declaration once already.
 */
declare module "*.css" {
  const content: string;
  export default content;
}
