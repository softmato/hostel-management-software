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
  // Geolocation for our own pages only: the map's "Use my location" and the
  // hostel pin pickers. `geolocation=()` refused it silently, with no prompt.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
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
 *
 * **Scoped to linux-x64, which is the only thing Vercel runs.** This used to be
 * a bare `@img/**` and that swept up whatever else npm had left in the tree —
 * the build host's own binaries and the wasm32 fallback — none of which a lambda
 * can load. Measured against a real build it was 46 MB copied into 37 functions
 * where ~19 MB was the linux pair and the rest was ballast.
 *
 * `sharp-libvips-linux-x64` is listed explicitly rather than left to the tracer:
 * it is the RPATH `dlopen` target of `sharp-linux-x64/sharp.node`, and a
 * `dlopen` is the one hop a static trace cannot follow. That is the omission
 * that produced `ERR_DLOPEN_FAILED: libvips-cpp.so` in production.
 */
const SHARP_NATIVE = [
  "../../node_modules/@img/sharp-linux-x64/**/*",
  "../../node_modules/@img/sharp-libvips-linux-x64/**/*",
  "./node_modules/@img/sharp-linux-x64/**/*",
  "./node_modules/@img/sharp-libvips-linux-x64/**/*",
];

/**
 * `@napi-rs/canvas`, which only the three routes that issue an ID card need.
 *
 * **A dynamic `import()` does not keep a package out of a bundle.** That was the
 * assumption, and it is wrong: `@vercel/nft` follows `await import("literal")`
 * exactly as it follows a static import, because it has to — the module must be
 * on disk for the runtime to load it later. Deferring the *load* does nothing
 * about the *trace*.
 *
 * So the 26 MB binary reached every function that could transitively see
 * `id-card-delivery.service` — 82 of them, including the public landing page and
 * `sitemap.xml` — for a card that is rendered on hostel approval, service
 * provider approval, and a resident saving their identity. Measured: 2.16 GB of
 * function storage per deployment.
 *
 * Excluding it everywhere and adding it back on those three paths is the only
 * mechanism that actually moves it, because it operates on the trace rather than
 * on the module graph.
 */
const CANVAS_NATIVE = [
  "../../node_modules/@napi-rs/canvas*/**/*",
  "./node_modules/@napi-rs/canvas*/**/*",
];

/**
 * Inter, for the same three routes.
 *
 * A lambda has no system fonts, and `fillText` against an unresolvable family
 * draws nothing without throwing — so the card PNGs attached to those emails
 * arrived as shapes with every glyph missing, and the renderer's own `catch`
 * never fired. The tracer cannot find these on its own: nothing `require`s a
 * `.ttf`, and `id-card-fonts.ts` resolves the directory at runtime precisely so
 * that nft does *not* sweep it.
 */
const ID_CARD_FONTS = ["./src/lib/fonts/*.ttf"];

const nextConfig: NextConfig = {
  transpilePackages: ["@hostel/db", "@hostel/shared"],
  /**
   * `@napi-rs/canvas` ships a prebuilt `.node` binary and must be `require`d
   * from node_modules at runtime, not bundled. Without this the ID-card
   * renderer fails silently inside Next — it works under vitest, which does no
   * bundling, so the gap only shows up in the running app.
   */
  /**
   * `unpdf` reads the text layer of PDF receipts. It carries its own pdf.js build
   * and resolves it at runtime, so it is external for the same reason as the two
   * above — and with the same silent failure if it is wrong, since a PDF that
   * cannot be read degrades to "no signal" rather than to an error.
   */
  serverExternalPackages: ["@napi-rs/canvas", "unpdf"],
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
  /**
   * Nothing gets the canvas binary unless the next block hands it back. Keyed
   * `**` because the leak was everywhere, and an allowlist is the only shape
   * that stays correct when somebody imports the delivery service somewhere new.
   */
  outputFileTracingExcludes: {
    "**": [
      ...CANVAS_NATIVE,
      /*
       * Static assets, the mobile app, and test files have no business in a
       * serverless bundle — and were costing ~1 GB per deployment sitting in one.
       *
       * They arrive through `lib/load-root-env`, which hunts the repo-root `.env`
       * by walking `process.cwd()`, `..` and `../..`. A trace cannot resolve a
       * path built that way, so `@vercel/nft` falls back to sweeping in the
       * candidate directories — and `instrumentation.ts` imports that module, so
       * every function inherits the sweep. Measured: `public/` copied into 426
       * functions, `apps/mobile/assets` into 426, plus `.test.ts` files and
       * mobile `README.md`s. It is the same mechanism that was attaching the
       * 5 MB OCR language model to `/api/v1/auth/login`.
       *
       * `public/**` is safe to drop here: Next serves it as static output from
       * the CDN, which `outputFileTracing*` does not govern. No function reads it.
       */
      "./public/**/*",
      "../mobile/**/*",
      "./src/**/*.test.ts",
      "./src/**/*.test.tsx",
    ],
  },
  outputFileTracingIncludes: {
    "/api/v1/files/**": SHARP_NATIVE,
    "/api/v1/hostel-admin/finance/**": SHARP_NATIVE,
    "/api/v1/public/files/**": SHARP_NATIVE,
    "/api/v1/resident/finance/**": SHARP_NATIVE,
    /*
     * The three card issuers, and the only places `renderIdCardPng` is reached.
     *
     * **The dynamic segment is `*`, not `[id]`.** These keys are globs, and in a
     * glob `[id]` is a character class matching the single letter `i` or `d` —
     * so `/api/v1/platform/hostels/[id]/approve` matches nothing at all, and
     * matches it silently. Written that way first, and the build was green:
     * approval simply shipped without the binary it loads, which surfaces as a
     * 500 the first time somebody approves a hostel. `*` matches one path
     * segment, `[id]` included.
     *
     * Only `/approve` on each: `sendIdCardEmail` is called behind a
     * `status === "APPROVED"` guard, and the import that reaches it is dynamic,
     * so reject and hide never load the binary and do not need to carry it.
     */
    "/api/v1/platform/hostels/*/approve": [...CANVAS_NATIVE, ...ID_CARD_FONTS],
    "/api/v1/platform/service-providers/*/approve": [...CANVAS_NATIVE, ...ID_CARD_FONTS],
    "/api/v1/users/resident-identity": [...CANVAS_NATIVE, ...ID_CARD_FONTS],
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
  async rewrites() {
    return [
      /*
       * Apple fetches the AASA from this exact path and will not follow a
       * redirect to find it, so this has to be a rewrite. It exists at all
       * because Next's app router skips folders whose name starts with a dot,
       * which rules out `app/.well-known/…` as a route.
       *
       * Its Android counterpart needs none of this: `assetlinks.json` is a
       * committed file under `public/.well-known/`, which Next serves verbatim
       * at the site root, dot-directory included. The handler explains why this
       * one cannot be a file.
       */
      {
        destination: "/api/apple-app-site-association",
        source: "/.well-known/apple-app-site-association",
      },
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
