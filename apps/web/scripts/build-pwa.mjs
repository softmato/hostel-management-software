/**
 * Deploy step: puts the exported phone app (PWA) in `public/app`, rebuilding it
 * only when something it is built from changed. Run by `vercel.json`.
 *
 * The export needs the whole Expo app installed and a Metro bundle — about four
 * minutes on every deploy, for output that is identical unless the phone app,
 * `packages/shared` or its public env changed. The last export is kept in
 * `.next/cache`, which Vercel restores between builds, keyed by the git tree of
 * those folders plus the env the export reads. No git, no cache: it just builds.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const OUT = "public/app";
const CACHE = ".next/cache/pwa";

function key() {
  try {
    const trees = execSync("git rev-parse HEAD:apps/mobile HEAD:packages/shared", {
      cwd: "../..",
      encoding: "utf8",
    });
    const env = Object.entries(process.env)
      .filter(([name]) => name.startsWith("EXPO_PUBLIC_") || name === "NEXT_PUBLIC_GOOGLE_CLIENT_ID")
      .sort();

    return createHash("sha256").update(trees).update(JSON.stringify(env)).digest("hex");
  } catch {
    return null;
  }
}

const current = key();
const cached = existsSync(`${CACHE}/key`) ? readFileSync(`${CACHE}/key`, "utf8") : null;

if (current && current === cached && existsSync(`${CACHE}/app`)) {
  cpSync(`${CACHE}/app`, OUT, { recursive: true });
  console.log("PWA unchanged — reused the cached export.");
} else {
  execSync("npm ci --prefix ../mobile --include=dev", { stdio: "inherit" });
  execSync("node ../mobile/scripts/export-pwa.mjs", { stdio: "inherit" });

  if (current) {
    rmSync(CACHE, { force: true, recursive: true });
    cpSync(OUT, `${CACHE}/app`, { recursive: true });
    writeFileSync(`${CACHE}/key`, current);
  }
}
