/**
 * The zero-prompt Downloads writer, if this binary has one.
 *
 * Wraps the local Expo module in `modules/hostelhub-downloads`, which inserts a
 * file into `MediaStore` — the one route to a user-visible folder on a modern
 * Android that costs no permission and no dialogue. The module's README has the
 * table of what the other four routes cost.
 *
 * Which folder is the module's decision, not this file's: documents land in
 * `Download/HostelHub/` and images in `Pictures/HostelHub/`, so a saved card
 * turns up in the gallery rather than in a download list. `path` comes back
 * saying which, and every message the user reads is built from it.
 *
 * ## `requireOptionalNativeModule`, and why this file never imports the module
 *
 * A native module only exists in a binary built after it was added. An `import`
 * from `modules/…` would resolve at bundle time and then blow up at runtime on
 * every older dev client and every existing install — the same failure
 * `manage/statements.tsx` documents for the document picker, and on a screen
 * this one it would take the whole download with it.
 *
 * `requireOptionalNativeModule` asks the runtime by name and answers `null` when
 * the module is not there. So this file is safe to import from anywhere, on any
 * build, on either platform: `saveToDownloads` simply reports that it could not,
 * and `downloadToDevice` walks down to the Storage Access Framework grant.
 *
 * That is deliberate rather than defensive. It means shipping this native module
 * is not a flag day — the JS is already correct on the builds that predate it.
 */

import { requireOptionalNativeModule } from "expo-modules-core";

type NativeDownloads = {
  /** False below Android 10, where the Downloads collection does not exist. */
  isSupported: boolean;
  /** Hands the saved file to whatever app opens its type. */
  openDownload: (uri: string, mimeType: string) => Promise<void>;
  saveToDownloads: (
    sourceUri: string,
    fileName: string,
    mimeType: string,
    subfolder: string,
  ) => Promise<SavedDownload>;
};

export type SavedDownload = {
  /** Where it landed, as a person reads it — `Download/HostelHub/x.csv`. */
  path: string;
  /**
   * The `content://` handle, which is the only thing that can later be opened.
   *
   * A path is not openable under scoped storage: another app handed a bare path
   * gets a permission error, so the notification carries this instead and the
   * intent takes a read grant with it. See `openDownload` in the Kotlin module.
   */
  uri: string;
};

const native = requireOptionalNativeModule<NativeDownloads>("HostelHubDownloads");

/**
 * Saves a file that is already on the device into `<subfolder>` of whichever
 * public folder suits its type.
 *
 * Returns the public path on success and `null` for every way of not managing
 * it — no module, no Downloads collection, or a MediaStore that refused the
 * write. **This never throws.** "Cannot" is a routine answer here and the caller
 * has two more rungs of ladder below it, so the one thing this function must not
 * do is take the whole download down with it.
 */
export async function saveSilently({
  fileName,
  mimeType,
  sourceUri,
  subfolder,
}: {
  /** With the extension — this is the name the user will see. */
  fileName: string;
  mimeType: string;
  /** `file://` URI of the copy already in the cache directory. */
  sourceUri: string;
  subfolder: string;
}): Promise<SavedDownload | null> {
  if (!native?.isSupported) {
    return null;
  }

  try {
    return await native.saveToDownloads(sourceUri, fileName, mimeType, subfolder);
  } catch (error) {
    /*
     * A rung that fails is a rung that cannot, and this one is the top of a
     * ladder with two more below it.
     *
     * The bytes are already on the device by the time this is called, so a
     * MediaStore refusal — a vendor-modified Downloads provider, a volume that
     * is not mounted, a name the provider will not take — must hand the file
     * down to the Storage Access Framework grant and then to the share sheet,
     * not end the download. Rethrowing meant a `saveToDownloads` rejection
     * escaped `downloadToDevice` past both remaining rungs and reached the user
     * as the raw Expo message, on every download button in the app.
     *
     * The native side already deletes its own half-written row before throwing,
     * so there is nothing to clean up here and nothing left in Downloads.
     */
    if (__DEV__) {
      console.warn("[downloads] MediaStore refused the file; falling back.", error);
    }

    return null;
  }
}

/**
 * Opens a file this app saved, from a notification tap.
 *
 * Silent when there is no native module — an older build has nothing to open
 * with, and throwing here would turn a tap on a stale notification into a crash
 * report. Returns whether it actually opened, so the caller can fall back to
 * routing into the app instead.
 */
export async function openDownloaded(uri: string, mimeType: string): Promise<boolean> {
  if (!native) {
    return false;
  }

  try {
    await native.openDownload(uri, mimeType);

    return true;
  } catch {
    return false;
  }
}
