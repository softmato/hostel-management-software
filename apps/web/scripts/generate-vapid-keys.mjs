/**
 * Mint the VAPID key pair that signs every browser push.
 *
 * Run once per environment, then paste the output into the root `.env`. The
 * public key is embedded in every subscription a browser creates against it, so
 * a later rotation does not "refresh" anything — it orphans every existing
 * subscription at once, and each browser stays silent until somebody re-opens
 * the site and it re-subscribes. Treat the pair as permanent.
 *
 *   npm run web:generate:vapid
 */

import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();

process.stdout.write(
  [
    "Add these to the repo root .env (see .env.example):",
    "",
    `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${keys.publicKey}`,
    `VAPID_PRIVATE_KEY=${keys.privateKey}`,
    "VAPID_SUBJECT=mailto:support@softmato.com",
    "",
    "The private key is a credential. It never belongs in the repo, in a",
    "screenshot, or in a NEXT_PUBLIC_ variable.",
    "",
  ].join("\n"),
);
