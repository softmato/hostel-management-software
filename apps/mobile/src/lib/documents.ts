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

/**
 * Writes an image that is already in hand as a `data:` URL, then shares it.
 *
 * For the ID card's QR, which the server renders with `qrcode` and returns
 * inline. Nothing is downloaded — the bytes arrived with the JSON — so this is
 * the same cache-folder-then-share tail as {@link downloadAndShare} without the
 * request.
 *
 * The share sheet is the route to the camera roll on both platforms ("Save to
 * Photos" / "Save image"). Writing to the gallery directly would need
 * `expo-media-library`, which is a native module and therefore a development
 * build — a cost worth paying only once somebody has asked for one tap instead
 * of two.
 */
export async function shareDataUrlImage({
  dataUrl,
  fileName,
}: {
  /** `data:image/<type>;base64,…`. */
  dataUrl: string;
  /** Without the extension; taken from the data URL's own MIME type. */
  fileName: string;
}) {
  const match = /^data:(image\/([a-z0-9.+-]+));base64,(.+)$/i.exec(dataUrl.trim());

  if (!match) {
    throw new Error("That image could not be read.");
  }

  const [, mimeType, extension, base64] = match;
  const folder = new Directory(Paths.cache, FOLDER);

  if (!folder.exists) {
    folder.create({ intermediates: true });
  }

  const target = new File(folder, `${safeFileName(fileName)}.${extension}`);

  if (target.exists) {
    target.delete();
  }

  target.create();
  /*
   * `{ encoding: "base64" }` rather than decoding to a `Uint8Array` ourselves.
   * `atob` is a Hermes built-in rather than a React Native guarantee, and a
   * hand-rolled decode of a 420px PNG is a pointless pass over the string when
   * the native side already accepts base64.
   */
  target.write(base64, { encoding: "base64" });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing isn't available on this device.");
  }

  await Sharing.shareAsync(target.uri, { mimeType, UTI: "public.png" });
}

/**
 * Shares a file that already exists on disk — the output of a view capture.
 *
 * Separate from `shareDataUrlImage` because the two start from different things:
 * that one is handed base64 by the server and has to write it out first, this one
 * is handed a `file://` URI that `captureRef` has already written. Collapsing
 * them would mean a function that takes "either a data URL or a path", which is
 * the shape that eventually gets passed the wrong one.
 */
export async function shareLocalImage(uri: string, mimeType = "image/png") {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing isn't available on this device.");
  }

  await Sharing.shareAsync(uri, { mimeType, UTI: "public.png" });
}
