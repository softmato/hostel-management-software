/**
 * Downloading a PDF that needs the bearer token, then handing it to the OS.
 *
 * `Linking.openURL` cannot do this. The receipt and statement routes stream
 * through our API and authorise the caller, so an unauthenticated GET from the
 * system browser gets a 401 — and on Android that renders as a downloaded file
 * containing a JSON error, which is worse than an error message because the
 * resident keeps it.
 *
 * So: download with the header, write to the cache directory, share. The cache
 * directory rather than documents because the OS may reclaim it — these are
 * copies of something the server can always regenerate, and a receipt that
 * silently accumulates on a 32 GB phone every time somebody taps it is not a
 * feature.
 */

import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { readTokens } from "@/lib/session";

/** Sub-folder so a cache sweep can be reasoned about, and names cannot collide. */
const FOLDER = "documents";

/**
 * Anything that is not a letter, digit, dash or dot becomes one dash.
 *
 * Receipt numbers come from the server and are tame today, but a filename is
 * a path: a `/` in one would write outside the folder, and a Windows-hostile
 * character breaks the share sheet on some targets.
 */
function safeFileName(name: string) {
  const cleaned = name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");

  return cleaned || "document";
}

export async function downloadAndShare({
  fileName,
  url,
}: {
  /** Without the extension. `.pdf` is appended. */
  fileName: string;
  url: string;
}) {
  const tokens = await readTokens();

  if (!tokens?.accessToken) {
    throw new Error("You need to be signed in to download this.");
  }

  const folder = new Directory(Paths.cache, FOLDER);

  if (!folder.exists) {
    folder.create({ intermediates: true });
  }

  const target = new File(folder, `${safeFileName(fileName)}.pdf`);

  // Overwritten rather than appended to: a second tap on the same receipt must
  // produce the same file, not a growing one.
  if (target.exists) {
    target.delete();
  }

  const file = await File.downloadFileAsync(url, target, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    idempotent: true,
  });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing isn't available on this device.");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
  });
}
