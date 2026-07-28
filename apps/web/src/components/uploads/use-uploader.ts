"use client";

import { useCallback, useId, useState, type ChangeEvent } from "react";

import { acceptAttribute, uploadHint, type UploadKind } from "@/lib/uploads/accepts";
import { uploadFiles, type UploadOptions } from "@/lib/uploads/uploader";
import { toast } from "@/stores/toast-store";
import { isActive, useUploadStore } from "@/stores/upload-store";

/**
 * React binding for the universal uploader.
 *
 * Owns the "which files does this field currently hold" list so call sites stop
 * hand-rolling `uploading` booleans, and leaves all progress reporting to the
 * global toaster.
 */

export type UploadedAsset = {
  /** FileAsset id — present for `asset` uploads. */
  assetId?: string;
  id: string;
  mimeType: string;
  name: string;
  sizeBytes: number;
  /** Directly readable URL — present for multipart uploads. */
  url?: string;
};

export type UseUploaderOptions = Omit<UploadOptions, "scope"> & {
  initialFiles?: UploadedAsset[];
  maxFiles?: number;
  /** Fires after every batch with the field's full, current file list. */
  onChange?: (files: UploadedAsset[]) => void;
};

export function useUploader(options: UseUploaderOptions = {}) {
  const { initialFiles, maxFiles = 1, onChange, ...uploadOptions } = options;

  const [files, setFiles] = useState<UploadedAsset[]>(initialFiles ?? []);
  const [isUploading, setIsUploading] = useState(false);
  // Stable per hook instance, so a screen can watch just its own uploads.
  const scope = useId();

  const commit = useCallback(
    (next: UploadedAsset[]) => {
      setFiles(next);
      onChange?.(next);
      return next;
    },
    [onChange],
  );

  /**
   * Deliberately not memoised: it closes over `files` and the caller's options,
   * both of which change freely, and it is only ever invoked from event
   * handlers where a fresh closure is exactly what we want.
   */
  async function uploadMany(incoming: File[]) {
    if (incoming.length === 0) {
      return [];
    }

    const room = Math.max(0, maxFiles - files.length);
    const fileWord = maxFiles === 1 ? "file" : "files";

    if (room === 0) {
      toast.warning({
        description: "Remove one before adding another.",
        title: `You can attach at most ${maxFiles} ${fileWord} here`,
      });
      return [];
    }

    const accepted = incoming.slice(0, room);

    if (incoming.length > room) {
      toast.warning({
        description: `Only the first ${room} ${room === 1 ? "file" : "files"} will be uploaded.`,
        title: `Limit is ${maxFiles} ${fileWord}`,
      });
    }

    setIsUploading(true);
    try {
      const outcomes = await uploadFiles(accepted, { ...uploadOptions, scope });

      const uploaded: UploadedAsset[] = outcomes
        .filter((outcome) => outcome.ok)
        .map((outcome) => {
          const { result } = outcome as Extract<typeof outcome, { ok: true }>;

          return {
            assetId: result.assetId,
            id: result.assetId ?? result.url ?? crypto.randomUUID(),
            mimeType: result.mimeType,
            name: result.fileName,
            sizeBytes: result.sizeBytes,
            url: result.url,
          };
        });

      if (uploaded.length > 0) {
        commit([...files, ...uploaded].slice(0, maxFiles));
      }

      return uploaded;
    } finally {
      setIsUploading(false);
    }
  }

  /** Single-file convenience. Resolves `null` when the upload did not succeed. */
  async function upload(file: File) {
    const [uploaded] = await uploadMany([file]);
    return uploaded ?? null;
  }

  /**
   * Drop straight onto `<input type="file" onChange={…} />`. Clears the input
   * afterwards so re-picking the same file still fires a change event.
   */
  async function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const picked = Array.from(input.files ?? []);

    if (picked.length === 0) {
      return;
    }

    await uploadMany(picked);
    input.value = "";
  }

  const remove = useCallback(
    (id: string) => commit(files.filter((file) => file.id !== id)),
    [commit, files],
  );

  const clear = useCallback(() => commit([]), [commit]);

  return {
    accept: acceptAttribute(uploadOptions.kind, uploadOptions.accept),
    canAddMore: files.length < maxFiles,
    clear,
    files,
    handleInputChange,
    hint: uploadHint(uploadOptions.kind, uploadOptions.accept),
    isUploading,
    maxFiles,
    remove,
    setFiles: commit,
    upload,
    uploadMany,
  };
}

/** The object {@link useUploader} returns — what `<FileUploaderView>` consumes. */
export type UploaderApi = ReturnType<typeof useUploader>;

/** True while *any* upload on the page is in flight — e.g. to gate a submit button. */
export function useIsUploading() {
  return useUploadStore((state) => state.items.some((item) => isActive(item.status)));
}

export type { UploadKind };
