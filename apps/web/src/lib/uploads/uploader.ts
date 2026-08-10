import type { FileAssetKind } from "@/lib/file-asset-kinds";
import { toast } from "@/stores/toast-store";
import { useUploadStore, type UploadItem } from "@/stores/upload-store";

import { validateFileForUpload, type UploadKind } from "./accepts";
import {
  sendUpload,
  UploadCanceledError,
  UploadError,
  type UploadResult,
  type UploadTarget,
} from "./transport";

/**
 * The universal uploader.
 *
 * Every file the site sends anywhere goes through {@link uploadFiles}: it
 * validates against the platform's accepted types, registers a row in the global
 * upload store (which the always-mounted toaster renders as a live progress
 * bar), streams the bytes with byte-level progress, and resolves with a
 * normalised result. Call sites never touch fetch, XHR or progress plumbing.
 */

export type UploadOptions = {
  /** Storage visibility. Only meaningful for the `asset` target. */
  accessLevel?: "PRIVATE" | "PROTECTED" | "PUBLIC";
  /** Overrides the accept list derived from `kind`, e.g. "image/png". */
  accept?: string;
  /**
   * What the file is *for*. Financial kinds are tenant-scoped at presign time
   * and are rejected if the caller's hostel cannot be resolved.
   */
  assetKind?: FileAssetKind;
  kind?: UploadKind;
  /** Human name for the thing being uploaded, e.g. "Payment proof". */
  label?: string;
  /** Fire-and-forget image derivative generation after a successful upload. */
  optimizeImage?: boolean;
  /** Groups related uploads in the store so a screen can watch just its own. */
  scope?: string;
  /** Suppresses the per-file success toast; errors always toast. */
  silent?: boolean;
  target?: UploadTarget;
};

export type UploadOutcome =
  | { error: string; file: File; ok: false }
  | { file: File; ok: true; result: UploadResult };

function humanizeError(error: unknown) {
  if (error instanceof UploadCanceledError) {
    return "Upload canceled.";
  }

  if (error instanceof UploadError || error instanceof Error) {
    return error.message;
  }

  return "Upload failed. Please try again.";
}

function newItem(file: File, options: UploadOptions): UploadItem {
  return {
    fileName: file.name,
    id: crypto.randomUUID(),
    label: options.label ?? file.name,
    loadedBytes: 0,
    mimeType: file.type,
    percent: 0,
    scope: options.scope ?? "global",
    sizeBytes: file.size,
    startedAt: Date.now(),
    status: "queued",
  };
}

async function runOne(file: File, options: UploadOptions): Promise<UploadOutcome> {
  const store = useUploadStore.getState();
  const target = options.target ?? "asset";
  const item = newItem(file, options);
  const controller = new AbortController();

  store.register(item, {
    controller,
    file,
    // Retry re-enters the same path with the same options, so a transient
    // network failure costs the user one click rather than re-picking the file.
    retry: () => void runOne(file, options),
    target,
  });

  store.update(item.id, { status: "uploading" });

  try {
    const result = await sendUpload(file, {
      accessLevel: options.accessLevel,
      assetKind: options.assetKind,
      onProgress: ({ loadedBytes, percent }) => {
        useUploadStore.getState().update(item.id, {
          loadedBytes,
          // Hold at 99 until the server confirms: the last byte being sent is
          // not the same as the upload being accepted.
          percent: Math.min(99, percent),
          status: percent >= 100 ? "processing" : "uploading",
        });
      },
      signal: controller.signal,
      target,
    });

    useUploadStore.getState().update(item.id, {
      endedAt: Date.now(),
      loadedBytes: file.size,
      percent: 100,
      result,
      status: "success",
    });

    if (options.optimizeImage && result.assetId) {
      // Derivatives are a nice-to-have; a failure here must not fail the upload.
      void import("@/lib/client-upload")
        .then(({ optimizeImage }) => optimizeImage(result.assetId!))
        .catch(() => {});
    }

    if (!options.silent) {
      toast.success({
        description: file.name,
        title: `${options.label ?? "File"} uploaded`,
      });
    }

    return { file, ok: true, result };
  } catch (error) {
    const canceled = error instanceof UploadCanceledError;
    const message = humanizeError(error);

    useUploadStore.getState().update(item.id, {
      endedAt: Date.now(),
      error: message,
      status: canceled ? "canceled" : "error",
    });

    if (!canceled) {
      toast.error({ description: file.name, title: message });
    }

    return { error: message, file, ok: false };
  }
}

/**
 * Uploads one or more files, sequentially so that progress stays legible and a
 * batch cannot saturate a slow connection. Never throws: each file resolves to
 * its own success/failure outcome so partial batches are reportable.
 */
export async function uploadFiles(
  files: File[],
  options: UploadOptions = {},
): Promise<UploadOutcome[]> {
  const outcomes: UploadOutcome[] = [];

  for (const file of files) {
    const invalid = validateFileForUpload(file, {
      accept: options.accept,
      kind: options.kind,
    });

    if (invalid) {
      toast.error({ title: "File not accepted", description: invalid });
      outcomes.push({ error: invalid, file, ok: false });
      continue;
    }

    outcomes.push(await runOne(file, options));
  }

  return outcomes;
}

/** Single-file convenience wrapper. Resolves `null` when the upload fails. */
export async function uploadFile(file: File, options: UploadOptions = {}) {
  const [outcome] = await uploadFiles([file], options);
  return outcome?.ok ? outcome.result : null;
}
