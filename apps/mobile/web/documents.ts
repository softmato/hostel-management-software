import type * as Native from "@/lib/documents";
import { readTokens } from "@/lib/session";
import { finishUpload, startDownload } from "@/lib/upload-queue";

/**
 * `lib/documents.ts` for the installable web app. The phone writes to a folder
 * and opens the share sheet; a browser saves files itself. So every entry point
 * comes down to one thing: fetch the file (with this session's token when it is
 * our route), hand the bytes to a download link, and show the same toaster row
 * the phone does. Each export is typed against the phone's, so the two cannot
 * drift apart silently.
 */

function safeFileName(name: string) {
  const cleaned = name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");

  return cleaned || "document";
}

async function save({
  authenticated,
  extension,
  fileName,
  label,
  url,
}: {
  authenticated: boolean;
  extension: string;
  fileName: string;
  label: string;
  url: string;
}) {
  const id = startDownload(label);

  try {
    const tokens = authenticated ? await readTokens() : null;

    if (authenticated && !tokens?.accessToken) {
      throw new Error("You need to be signed in to download this.");
    }

    const response = await fetch(url, {
      headers: tokens?.accessToken ? { Authorization: `Bearer ${tokens.accessToken}` } : {},
    });

    if (!response.ok) {
      throw new Error(`It could not be downloaded (error ${response.status}).`);
    }

    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");

    link.href = href;
    link.download = `${safeFileName(fileName)}.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
    finishUpload(id);
  } catch (error) {
    finishUpload(id, { error: error instanceof Error ? error.message : "It could not be downloaded." });
    throw error;
  }
}

export const downloadAndShare: typeof Native.downloadAndShare = ({ fileName, url }) =>
  save({ authenticated: true, extension: "pdf", fileName, label: fileName, url });

export const downloadAndShareImage: typeof Native.downloadAndShareImage = ({
  authorize = false,
  fileName,
  mimeType = "image/jpeg",
  url,
}) =>
  save({
    authenticated: authorize,
    extension: (mimeType.split("/")[1] ?? "jpg").replace("jpeg", "jpg"),
    fileName,
    label: fileName,
    url,
  });

export const downloadAndShareCsv: typeof Native.downloadAndShareCsv = ({ fileName, url }) =>
  save({ authenticated: true, extension: "csv", fileName, label: fileName, url });

export const downloadToDevice: typeof Native.downloadToDevice = ({
  authenticated = true,
  extension,
  fileName,
  label,
  url,
}) => save({ authenticated, extension, fileName, label, url });

export const saveDataUrlToDevice: typeof Native.saveDataUrlToDevice = ({ dataUrl, fileName, label }) =>
  save({
    authenticated: false,
    extension: dataUrl.slice(dataUrl.indexOf("/") + 1, dataUrl.indexOf(";")).replace("jpeg", "jpg"),
    fileName,
    label,
    url: dataUrl,
  });

export const saveToDevice: typeof Native.saveToDevice = ({ extension, fileName, label, uri }) =>
  save({ authenticated: false, extension, fileName, label, url: uri });

/** The browser picks its own download folder; there is none to forget. */
export const forgetDownloadFolder: typeof Native.forgetDownloadFolder = async () => {};
