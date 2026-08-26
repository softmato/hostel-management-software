/**
 * The single source of truth for "what is uploading right now".
 *
 * Ports the web's `stores/upload-store.ts` rule: **every** upload started
 * anywhere in the app registers here, which is what lets one always-mounted
 * toaster show live progress without any screen wiring it up. Call sites stop
 * building their own progress UI, so a payment proof and a food photo report
 * the same way.
 *
 * ## Why this is not a Redux slice
 *
 * `redux-persist` writes the store to AsyncStorage on change, and a byte-level
 * progress callback fires dozens of times a second — that is dozens of disk
 * writes per photo, on the low-end Android handsets this app is aimed at. It is
 * also state with no meaning after a relaunch: an upload interrupted by the app
 * dying did not happen. So it is a plain module-level store, read through
 * `useSyncExternalStore`, and it never touches disk.
 *
 * ## Why the pure parts live here
 *
 * Vitest runs node-side with no React Native shim (see `lib/status.ts`), so the
 * label table and the linger rules are testable only if they stay clear of
 * anything importing `react-native`. The component is the untestable half and
 * holds nothing but styling.
 */

export type UploadStage =
  | "failed"
  | "presigning"
  | "succeeded"
  | "uploading"
  | "verifying";

/**
 * Which way the bytes are going.
 *
 * The queue was built for uploads and the stage names still say so, because
 * that is what almost every transfer in this app is. A download borrows the
 * same five stages rather than getting its own set — the shape of the work is
 * identical (prepare, move bytes, settle, done or failed) and only the *words*
 * differ, which is exactly what `uploadRowMessage` is for.
 *
 * Required rather than defaulted, so every construction site says which it is.
 * A row that silently claimed to be an upload would report "Uploading 45%" over
 * a download, which is the one failure this field exists to prevent.
 */
export type TransferDirection = "download" | "upload";

export type UploadRow = {
  direction: TransferDirection;
  /** Wall-clock ms when the transfer finished, succeeded or not. */
  endedAt: number | null;
  error: string | null;
  /** 0–1, or null while the size is unknown. */
  fraction: number | null;
  id: string;
  /** What the user was doing, e.g. "Payment proof". Not the file name. */
  label: string;
  /**
   * Set on a finished **download** that landed somewhere openable.
   *
   * Lives on the row rather than in the screen that started the transfer,
   * because the thing that needs it — the completion notification — is built
   * long after that screen may have been popped. Absent on uploads, and on a
   * download that ended in the share sheet: there is nothing left to open.
   */
  openMimeType?: string;
  /** Where it landed, as a person reads it — `Download/HostelHub/x.csv`. */
  openPath?: string;
  openUri?: string;
  stage: UploadStage;
  startedAt: number;
};

/**
 * How long a finished row stays on screen.
 *
 * A failure lingers far longer than a success on purpose: a success is
 * confirmed by the thing that appears on the screen behind it, whereas a
 * failure is the only notice the user gets, and 2 seconds is not long enough to
 * read a sentence and decide what to do about it.
 */
export const SUCCESS_LINGER_MS = 2_500;
export const FAILURE_LINGER_MS = 8_000;

export function isUploadActive(stage: UploadStage) {
  return stage === "presigning" || stage === "uploading" || stage === "verifying";
}

/** When this row should stop being drawn, or `null` while it is still running. */
export function expiresAt(row: UploadRow): number | null {
  if (row.endedAt === null) {
    return null;
  }

  return (
    row.endedAt + (row.stage === "failed" ? FAILURE_LINGER_MS : SUCCESS_LINGER_MS)
  );
}

/** Drops finished rows whose linger has run out. Keeps everything in flight. */
export function pruneUploads(rows: readonly UploadRow[], now: number): UploadRow[] {
  return rows.filter((row) => {
    const deadline = expiresAt(row);

    return deadline === null || deadline > now;
  });
}

/**
 * The one line of text a row shows.
 *
 * Stages are named after what the *user* is waiting for, not after the HTTP
 * call: "Checking the file" is `verifying`, which is a server round trip they
 * did not ask for and would otherwise read as a stall at 100%.
 */
export function uploadRowMessage(row: UploadRow): string {
  const down = row.direction === "download";

  switch (row.stage) {
    case "failed":
      return row.error ?? (down ? "Download failed." : "Upload failed.");
    case "presigning":
      return "Preparing…";
    case "succeeded":
      return down ? "Saved to your device" : "Uploaded";
    case "verifying":
      /*
       * The same stage, two different waits. On an upload this is a server
       * round trip checking the file; on a download the bytes are already here
       * and what is left is writing them where the user asked — which on
       * Android is a folder write that can visibly take a moment on a large
       * export. Naming it "Checking the file…" would describe work that is not
       * happening.
       */
      return down ? "Saving…" : "Checking the file…";
    case "uploading":
      if (row.fraction === null) {
        return down ? "Downloading…" : "Uploading…";
      }

      return `${down ? "Downloading" : "Uploading"} ${Math.round(row.fraction * 100)}%`;
  }
}

/**
 * The bar's fill, 0–1.
 *
 * A finished row reads 1 whatever its last progress event said, and an unknown
 * size reads a third rather than zero — a bar pinned at empty while bytes are
 * demonstrably moving is the thing that makes people force-quit.
 */
export function uploadRowFraction(row: UploadRow): number {
  if (row.stage === "succeeded" || row.stage === "verifying") {
    return 1;
  }

  if (row.stage === "failed") {
    return row.fraction ?? 0;
  }

  if (row.stage === "presigning") {
    return 0;
  }

  return row.fraction ?? 0.33;
}

/* -------------------------------------------------------------------------- */
/* The store                                                                  */
/* -------------------------------------------------------------------------- */

let rows: UploadRow[] = [];
const listeners = new Set<() => void>();
let sequence = 0;

function emit(next: UploadRow[]) {
  rows = next;

  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToUploads(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Must return the *same* array reference until something changes —
 * `useSyncExternalStore` compares by identity and a fresh array every call is
 * an infinite render loop.
 */
export function getUploadRows(): readonly UploadRow[] {
  return rows;
}

function startTransfer(
  label: string,
  direction: TransferDirection,
  now: number,
): string {
  sequence += 1;
  const id = `upload-${sequence}`;

  emit([
    ...rows,
    {
      direction,
      endedAt: null,
      error: null,
      fraction: 0,
      id,
      label,
      stage: "presigning",
      startedAt: now,
    },
  ]);

  return id;
}

export function startUpload(label: string, now: number = Date.now()): string {
  return startTransfer(label, "upload", now);
}

/**
 * The same row, going the other way — a receipt PDF or a CSV export on its way
 * to the phone.
 *
 * Registered in this queue rather than given its own progress UI for the reason
 * the queue exists at all: one always-mounted toaster reports every transfer in
 * the app, so a call site never builds its own bar. The id prefix stays
 * `upload-` deliberately — it is a sequence number, not a claim about direction,
 * and changing it would be a change to strings other code compares.
 */
export function startDownload(label: string, now: number = Date.now()): string {
  return startTransfer(label, "download", now);
}

export function updateUpload(
  id: string,
  patch: Partial<Pick<UploadRow, "fraction" | "stage">>,
) {
  const index = rows.findIndex((row) => row.id === id);

  if (index === -1) {
    return;
  }

  const next = [...rows];
  next[index] = { ...next[index], ...patch };
  emit(next);
}

export function finishUpload(
  id: string,
  outcome: {
    error?: string;
    openMimeType?: string;
    openPath?: string;
    openUri?: string;
  } = {},
  now: number = Date.now(),
) {
  const index = rows.findIndex((row) => row.id === id);

  if (index === -1) {
    return;
  }

  const next = [...rows];
  next[index] = {
    ...next[index],
    endedAt: now,
    error: outcome.error ?? null,
    openMimeType: outcome.openMimeType,
    openPath: outcome.openPath,
    openUri: outcome.openUri,
    stage: outcome.error ? "failed" : "succeeded",
  };
  emit(next);
}

/** Called by the toaster's tick and by the dismiss button. */
export function sweepUploads(now: number = Date.now()) {
  const next = pruneUploads(rows, now);

  if (next.length !== rows.length) {
    emit(next);
  }
}

export function dismissUpload(id: string) {
  const next = rows.filter((row) => row.id !== id);

  if (next.length !== rows.length) {
    emit(next);
  }
}

/** Test seam. Nothing in the app clears the queue wholesale. */
export function resetUploadQueue() {
  rows = [];
  sequence = 0;
}
