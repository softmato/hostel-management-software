/**
 * The zero-prompt Downloads writer, if this binary has one.
 *
 * Wraps the local Expo module in `modules/hostelhub-downloads`, which inserts a
 * file into `MediaStore.Downloads` — the one route to a user-visible Downloads
 * folder on a modern Android that costs no permission and no dialogue. The
 * module's README has the table of what the other four routes cost.
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
 * Saves an already-downloaded file into `Download/<subfolder>/`.
 *
 * Returns the public path on success and `null` when this build or device cannot
 * do it — never throws for that case, because "cannot" is a routine answer here
 * and the caller has two more rungs of ladder below it. A genuine failure *after*
 * the write started does throw, since that is a broken download rather than a
 * missing capability.
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

  return native.saveToDownloads(sourceUri, fileName, mimeType, subfolder);
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
