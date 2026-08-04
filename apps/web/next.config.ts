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

const nextConfig: NextConfig = {
  transpilePackages: ["@hostel/db", "@hostel/shared"],
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
