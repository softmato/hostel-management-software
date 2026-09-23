/**
 * Builds the installable web app (PWA) into `apps/web/public/app`, where the
 * website serves it at `/app`. Run by the web deploy (`apps/web/vercel.json`).
 *
 * `EXPO_PWA` is what turns on the `/app` base path in `app.config.js`; it is set
 * here and nowhere else so the native config, and with it the update
 * fingerprint, never sees it. The website's Google client id is the same web
 * client the phone asks for its id token with, so a deploy that only has the
 * website's variables still gets Google sign-in.
 *
 * Deliberately not an npm script: `package.json` scripts are part of the update
 * fingerprint, and a new one would strand every installed build's OTA channel.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const env = {
  ...process.env,
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "",
  EXPO_PWA: "1",
};

const { status } = spawnSync(
  join("node_modules", ".bin", "expo"),
  ["export", "--platform", "web", "--output-dir", "../web/public/app", "--clear"],
  { cwd: fileURLToPath(new URL("..", import.meta.url)), env, shell: true, stdio: "inherit" },
);

process.exit(status ?? 1);
