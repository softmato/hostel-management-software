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

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, DownloadTask, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { readTokens } from "@/lib/session";
import { toastSuccess } from "@/lib/toast";
import { finishUpload, startDownload, updateUpload } from "@/lib/upload-queue";

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

/**
 * Downloads a remote image and hands it to the share sheet — the global asset
 * viewer's "Save" action.
 *
 * Separate from `downloadAndShare`, which is the receipt path and is PDF-shaped
 * all the way down (`.pdf` appended, PDF mime, PDF UTI, always authorised).
 * This one differs in the way that matters:
 *
 * **The header is a parameter, and the default is off.** A private asset needs
 * the bearer token on our route; a public one must not carry one, because R2
 * reads any `Authorization` header as SigV4 and rejects the request outright
 * (measured 2026-08-17 — see `privateAssetSource` in `lib/uploads.ts`). Sending
 * it "just in case" breaks exactly the images that work today, so the caller
 * says which kind it has and `lib/asset-viewer.ts` is what decides.
 *
 * The extension comes from the mime type rather than from the URL: the
 * authorising route ends in `/url`, so a name taken from the path would save
 * every private image as a file the gallery refuses to open.
 */
export async function downloadAndShareImage({
  authorize = false,
  fileName,
  mimeType = "image/jpeg",
  url,
}: {
  /** Attach the session's bearer token. Only for `files/[assetId]/url`. */
  authorize?: boolean;
  /** Without the extension. */
  fileName: string;
  mimeType?: string;
  url: string;
}) {
  const headers: Record<string, string> = {};

  if (authorize) {
    const tokens = await readTokens();

    if (!tokens?.accessToken) {
      throw new Error("You need to be signed in to save this.");
    }

    headers.Authorization = `Bearer ${tokens.accessToken}`;
  }

  const folder = new Directory(Paths.cache, FOLDER);

  if (!folder.exists) {
    folder.create({ intermediates: true });
  }

  const extension = mimeType.split("/")[1]?.split("+")[0] || "jpg";
  const target = new File(folder, `${safeFileName(fileName)}.${extension}`);

  // Overwritten rather than appended to: saving the same photo twice must
  // produce the same file, not a growing one.
  if (target.exists) {
    target.delete();
  }

  const file = await File.downloadFileAsync(url, target, { headers, idempotent: true });

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing isn't available on this device.");
  }

  // The share sheet is the route to the camera roll on both platforms; writing
  // to the gallery directly would need `expo-media-library` and a new native
  // module. Same trade already taken by `shareDataUrlImage`.
  await Sharing.shareAsync(file.uri, { mimeType });
}

/**
 * Downloads an authorised CSV and hands it to the share sheet.
 *
 * The report exports are `GET` routes that answer `text/csv` with a
 * `Content-Disposition` filename, which a browser turns into a download and a
 * phone turns into nothing at all — there is no download tray to land in. So the
 * bytes go to the cache directory under a name we choose and the share sheet
 * takes it from there: mail it to the accountant, drop it in Drive, open it in
 * whatever spreadsheet app is installed.
 *
 * Same shape as {@link downloadAndShare}, which does this for receipt PDFs. The
 * two are kept apart rather than parameterised on MIME type because the failure
 * messages differ and both are read by a person mid-task.
 */
export async function downloadAndShareCsv({
  fileName,
  url,
}: {
  /** Without the extension. `.csv` is appended. */
  fileName: string;
  url: string;
}) {
  const tokens = await readTokens();

  if (!tokens?.accessToken) {
    throw new Error("You need to be signed in to export this.");
  }

  const folder = new Directory(Paths.cache, FOLDER);

  if (!folder.exists) {
    folder.create({ intermediates: true });
  }

  const target = new File(folder, `${safeFileName(fileName)}.csv`);

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
    mimeType: "text/csv",
    UTI: "public.comma-separated-values-text",
  });
}

/* -------------------------------------------------------------------------- */
/* Downloading to the device                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Where Android was last told to put downloads — a SAF tree URI.
 *
 * AsyncStorage rather than SecureStore: it is a folder path, not a secret, and
 * SecureStore is for the two tokens and nothing else (see `lib/session.ts`).
 */
const DOWNLOAD_FOLDER_KEY = "hh_download_folder_uri";

/**
 * `expo-file-system/legacy`, loaded only when a file is actually being saved.
 *
 * The modern API has no Storage Access Framework, and SAF is the only way an
 * app can write into a folder the user can browse on Android 11+ — the old
 * `WRITE_EXTERNAL_STORAGE` route has been closed since API 30. The legacy entry
 * point is part of the **same installed native module**, so this needs no
 * rebuild; requiring it lazily keeps a platform-specific import off the iOS path
 * and out of module load, the same trade `manage/statements.tsx` takes for the
 * document picker.
 *
 * Typed here rather than imported, because the legacy module's own types pull in
 * the whole deprecated surface for the four functions actually used.
 */
type LegacyFileSystem = {
  StorageAccessFramework: {
    createFileAsync: (parentUri: string, fileName: string, mimeType: string) => Promise<string>;
    getUriForDirectoryInRoot: (folderName: string) => string;
    requestDirectoryPermissionsAsync: (
      initialFileUrl?: string | null,
    ) => Promise<{ directoryUri: string; granted: boolean }>;
    writeAsStringAsync: (
      fileUri: string,
      contents: string,
      options?: { encoding?: string },
    ) => Promise<void>;
  };
};

function loadLegacyFileSystem(): LegacyFileSystem | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-file-system/legacy") as LegacyFileSystem;
  } catch {
    return null;
  }
}

/**
 * The folder Android downloads go into, asking for one the first time only.
 *
 * ## Why the app asks once rather than never
 *
 * There is no unprompted way to write into `Download/` on a modern Android —
 * that is what scoped storage is. What there *is* is a one-time directory grant
 * that survives restarts, so the honest version of "just download it" is: pick
 * the folder once, then never be asked again. The picker opens on `Download`
 * already, so for most people it is one tap, once, ever.
 *
 * Returns `null` when the user declines. Declining is a real answer, and the
 * caller falls back to the share sheet rather than failing a download whose
 * bytes are already on the device.
 */
async function resolveDownloadFolder(saf: LegacyFileSystem["StorageAccessFramework"]) {
  const remembered = await AsyncStorage.getItem(DOWNLOAD_FOLDER_KEY);

  if (remembered) {
    return remembered;
  }

  const permission = await saf.requestDirectoryPermissionsAsync(
    saf.getUriForDirectoryInRoot("Download"),
  );

  if (!permission.granted) {
    return null;
  }

  await AsyncStorage.setItem(DOWNLOAD_FOLDER_KEY, permission.directoryUri);

  return permission.directoryUri;
}

/** Forgets the chosen folder, so the next download asks for one again. */
export async function forgetDownloadFolder() {
  await AsyncStorage.removeItem(DOWNLOAD_FOLDER_KEY);
}

/**
 * Downloads an authorised file and **saves it to the device**, reporting into
 * the global transfer toaster the whole way.
 *
 * ## Why this exists beside `downloadAndShare`
 *
 * That one ends at the share sheet, which is the right ending for a receipt
 * somebody is about to send to a resident and the wrong one for an export
 * somebody wants to *keep*. Being asked "share to…" after pressing a download
 * button is the app re-opening a decision the user already made.
 *
 * So here the bytes land in a folder the user chose, and the only dialogue is
 * the one-time folder grant.
 *
 * ## Progress, because a silent button is indistinguishable from a broken one
 *
 * Registered with `startDownload`, so `<UploadToaster />` draws it at the top of
 * whatever screen the user is on — and keeps drawing it if they navigate away,
 * because this is a plain module and does not care which screen started it. The
 * caller needs no spinner and gets no progress callback.
 *
 * ## iOS has no Downloads folder
 *
 * SAF is Android-only, and iOS has no user-browsable filesystem to write into;
 * the platform's own idea of a download is Files, reached through the share
 * sheet. So there the transfer is still reported in the toaster and still not a
 * silent button — it just ends in `Sharing`, which is what "download" means on
 * that platform. Same fallback when an Android user declines the folder grant.
 */
export async function downloadToDevice({
  extension,
  fileName,
  label,
  mimeType,
  url,
}: {
  /** Without the dot — `csv`, `pdf`. */
  extension: string;
  /** Without the extension. */
  fileName: string;
  /** What the user asked for, as the toaster says it — "Statement export". */
  label: string;
  mimeType: string;
  url: string;
}) {
  const id = startDownload(label);

  try {
    const tokens = await readTokens();

    if (!tokens?.accessToken) {
      throw new Error("You need to be signed in to download this.");
    }

    const folder = new Directory(Paths.cache, FOLDER);

    if (!folder.exists) {
      folder.create({ intermediates: true });
    }

    const safe = safeFileName(fileName);
    const target = new File(folder, `${safe}.${extension}`);

    // Overwritten rather than appended to, same rule as every other transfer in
    // this file: a second download of the same export must produce the same
    // file, not a growing one.
    if (target.exists) {
      target.delete();
    }

    updateUpload(id, { fraction: 0, stage: "uploading" });

    /*
     * No `idempotent` flag on this one — `DownloadTask` has no such option, only
     * the simpler `File.downloadFileAsync` does. The delete above is what makes
     * a repeat download safe instead.
     */
    const task = new DownloadTask(url, target, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      onProgress: ({ bytesWritten, totalBytes }) => {
        /*
         * `totalBytes` is `-1` when the server sent no `Content-Length`, which
         * a streamed CSV export does not. `null` is the queue's word for "size
         * unknown" and parks the bar at a third rather than at zero — a bar
         * pinned empty while bytes are visibly moving is what makes people
         * force-quit. See `uploadRowFraction`.
         */
        updateUpload(id, {
          fraction: totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null,
        });
      },
    });

    const downloaded = await task.downloadAsync();
    const uri = downloaded?.uri ?? target.uri;

    // The bytes are here; what is left is putting them where the user can find
    // them. This stage reads "Saving…" on a download — see `uploadRowMessage`.
    updateUpload(id, { fraction: 1, stage: "verifying" });

    const saf =
      Platform.OS === "android" ? (loadLegacyFileSystem()?.StorageAccessFramework ?? null) : null;
    const destination = saf ? await resolveDownloadFolder(saf) : null;

    if (saf && destination) {
      try {
        const fileUri = await saf.createFileAsync(destination, safe, mimeType);

        /*
         * Base64 through JS rather than a native move, because SAF has no
         * relocate that accepts a `file://` source. Fine for an export or a
         * receipt — both are kilobytes — and the reason this is not the
         * function to reach for with a video.
         */
        await saf.writeAsStringAsync(fileUri, await new File(uri).base64(), {
          encoding: "base64",
        });

        finishUpload(id);
        toastSuccess("Downloaded", `Saved as ${safe}.${extension} in your chosen folder.`);

        return;
      } catch {
        /*
         * The remembered grant is gone — the user cleared app data, or removed
         * the card it pointed at. Forget it so the next attempt asks again, and
         * hand this one to the share sheet rather than losing a file that has
         * already been downloaded.
         */
        await forgetDownloadFolder();
      }
    }

    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("There is nowhere to save this on this device.");
    }

    await Sharing.shareAsync(uri, { mimeType });
    finishUpload(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The download failed.";

    /*
     * The row is failed *and* the error rethrown. The toaster is the ambient
     * report and the caller still owns the foreground one — a screen that
     * silently continued past a failed download would leave the button looking
     * like it worked.
     */
    finishUpload(id, { error: message });
    throw error;
  }
}
