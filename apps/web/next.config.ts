import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

loadEnvConfig(repoRoot);

/**
 * Security response headers (PHASES.md §5.1 — the "Helmet.js" item; Next serves
 * these itself, so no middleware is involved).
 *
 * Notably absent: `Content-Security-Policy`. Next's runtime needs either a
 * per-request nonce or `'unsafe-inline'` for its hydration scripts, and a CSP
 * with `'unsafe-inline'` buys nothing while creating the impression of cover.
 * Adding a real nonce-based policy is its own task; XSS is currently held off
 * by React escaping (no `dangerouslySetInnerHTML` anywhere in the app).
 */
const SECURITY_HEADERS = [
  // Never let a browser sniff a JSON error into HTML and run it.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No hostel portal has any reason to be framed.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Location is collected by the mobile app, not the site.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // 1 year, subdomains included. Only sent over HTTPS by browsers.
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  // Isolate this document from other browsing contexts, but keep `window.opener`
  // alive for popups we open ourselves — Google Identity Services signs in via a
  // popup that posts the credential back to the opener, and plain `same-origin`
  // silently strands it on accounts.google.com/gsi/transform.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

/**
 * Both spellings on purpose: npm hoists `@img/*` to the workspace root, but a
 * platform-specific reinstall can land it beside the app instead. A glob that
 * matches nothing is a no-op.
 */
const SHARP_NATIVE = [
  "../../node_modules/@img/**/*",
  "./node_modules/@img/**/*",
];

/**
 * What the recogniser needs at runtime, none of which the tracer can find.
 *
 * Three separate hops it cannot follow, and missing any one of them broke OCR
 * in production while every local run stayed green:
 *
 * 1. **The worker script.** `tesseract.js` spawns `new Worker(workerPath)` where
 *    `workerPath` is built with `path.join(__dirname, …)` at runtime. A computed
 *    path is invisible to a static trace, so the file was simply absent — and
 *    `new Worker` on a missing path never signals ready, which is why the read
 *    hung rather than failed.
 * 2. **The WASM cores.** `worker-script/node/getCore.js` picks one of six builds
 *    by `require`ing a name it assembles from runtime SIMD feature detection.
 *    Also invisible, also fatal.
 * 3. **The language model.** `tessdata/eng.traineddata`, which
 *    `evidence-ocr.ts` now reads off disk instead of fetching from a CDN. It is
 *    data, so nothing `require`s it at all.
 *
 * ~20 MB, listed only on the two subtrees that actually recognise anything.
 */
const TESSERACT_RUNTIME = [
  "../../node_modules/tesseract.js/src/**/*",
  "./node_modules/tesseract.js/src/**/*",
  "../../node_modules/tesseract.js-core/**/*",
  "./node_modules/tesseract.js-core/**/*",
  "./tessdata/**/*",
];

const nextConfig: NextConfig = {
  transpilePackages: ["@hostel/db", "@hostel/shared"],
  /**
   * `@napi-rs/canvas` ships a prebuilt `.node` binary and must be `require`d
   * from node_modules at runtime, not bundled. Without this the ID-card
   * renderer fails silently inside Next — it works under vitest, which does no
   * bundling, so the gap only shows up in the running app.
   */
  /**
   * `tesseract.js` is here for the same reason and the same trap: it resolves its
   * WASM core and language model out of `node_modules` at runtime and starts a
   * worker to run them. Bundled, those paths do not exist — and because the
   * evidence recogniser degrades to "no signal" on any failure, it would fail
   * *silently*: every claim flagged `EVIDENCE_NOT_MACHINE_CHECKED`, no error
   * anywhere, and it works under vitest.
   */
  /**
   * `unpdf` reads the text layer of PDF receipts. It carries its own pdf.js build
   * and resolves it at runtime, so it is external for the same reason as the two
   * above — and with the same silent failure if it is wrong, since a PDF that
   * cannot be read degrades to "no signal" rather than to an error.
   */
  serverExternalPackages: [
    "@napi-rs/canvas",
    "tesseract.js",
    "tesseract.js-core",
    "unpdf",
  ],
  /**
   * Where the dependency trace starts. Explicit because this is a workspace: the
   * packages below are hoisted to the repo root, and an inferred root of
   * `apps/web` would put them outside the trace and silently drop the includes.
   */
  outputFileTracingRoot: repoRoot,
  /**
   * `sharp`'s native binary, shipped by hand.
   *
   * The tracer follows `require`s. It cannot follow a `dlopen`, and that is the
   * one hop that matters here: `@img/sharp-linux-x64/sharp.node` opens
   * `libvips-cpp.so` out of the sibling `@img/sharp-libvips-linux-x64` at load
   * time, by RPATH. Deployed without it, the function got a `sharp` it could not
   * open — `ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3` — which is what turned
   * every ID-photo upload into a 500 at 100%.
   *
   * `lib/sharp.ts` now survives the absence, so this is about keeping the
   * feature rather than the route. Listed per route subtree rather than
   * globally: it is ~30 MB, and only the image paths decode anything.
   */
  outputFileTracingIncludes: {
    "/api/v1/files/**": SHARP_NATIVE,
    "/api/v1/hostel-admin/finance/**": [...SHARP_NATIVE, ...TESSERACT_RUNTIME],
    "/api/v1/public/files/**": SHARP_NATIVE,
    "/api/v1/resident/finance/**": [...SHARP_NATIVE, ...TESSERACT_RUNTIME],
  },
  async headers() {
    return [{ headers: SECURITY_HEADERS, source: "/:path*" }];
  },
  async redirects() {
    return [
      // The resident feed became one platform-wide community. Old links and
      // bookmarks land where the conversation actually moved to.
      { destination: "/community", permanent: true, source: "/resident/community" },
    ];
  },
  turbopack: {
    root: repoRoot,
  },
  env: {
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  },
  images: {
    remotePatterns: [{ hostname: "lh3.googleusercontent.com", protocol: "https" }],
  },
};

export default nextConfig;
