/**
 * `sharp`, loaded at call time and allowed to be missing.
 *
 * `sharp` is a native addon: the JS package dlopens a platform-specific `.node`
 * binary, which in turn dlopens `libvips-cpp.so` from a sibling package. Either
 * can be absent from a deployed bundle even though the install succeeded —
 * production hit exactly that, `ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3`, and
 * because every consumer imported `sharp` at the top of its module the failure
 * landed at *module load*: `POST /api/v1/files/[assetId]/complete` returned
 * FUNCTION_INVOCATION_FAILED before it ran a line of its own code, so a resident
 * uploading their ID photo watched the bar reach 100% and then saw a 500.
 *
 * That is the wrong shape of failure. Nothing sharp does on the upload path is
 * load-bearing: it measures an image so the finance module can *score* evidence,
 * and every consumer already treats "could not read this" as missing data rather
 * than an error. So the import moves here, behind a promise that resolves to
 * `null` instead of throwing, and each caller degrades the way it already knew
 * how to.
 *
 * Cached including the failure: a native binary that is not on disk will not
 * appear later in the same process, and retrying the import per request would
 * pay the resolution cost on every upload to reach the same answer.
 */

type SharpFactory = (typeof import("sharp"))["default"];

let pending: Promise<SharpFactory | null> | null = null;

/** The `sharp` factory, or `null` when this deployment has no usable binary. */
export function loadSharp(): Promise<SharpFactory | null> {
  pending ??= import("sharp")
    .then((module) => module.default)
    .catch((error: unknown) => {
      // Loud in the log, silent to the caller: an operator needs to know image
      // analysis is off platform-wide, and it is not the uploader's problem.
      console.error(
        "[sharp] native module unavailable — image inspection, perceptual hashing and variants are disabled for this process",
        error,
      );

      return null;
    });

  return pending;
}
