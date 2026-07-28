"use client";

import { useEffect, useState } from "react";

/**
 * Shared body of the app's error boundaries.
 *
 * The failure this exists for is the stale-chunk crash: after a deploy (or a
 * dev rebuild) the browser holds an old build's module graph, and the first
 * navigation that needs a chunk the new build renamed dies with "module
 * factory is not available" / "Loading chunk failed". Nothing is actually
 * broken — the page just needs the current build — so we reload once and get
 * on with it. The reload is guarded by a session flag so a genuinely broken
 * page cannot spin in a refresh loop; the second failure shows the panel.
 */

const RELOAD_FLAG = "hh:chunk-reload";

function isStaleBuildError(error: Error) {
  const text = `${error.name} ${error.message}`;

  return (
    /module factory is not available/i.test(text) ||
    /Loading (chunk|CSS chunk)/i.test(text) ||
    /ChunkLoadError/i.test(text) ||
    /Failed to fetch dynamically imported module/i.test(text) ||
    /error loading dynamically imported module/i.test(text)
  );
}

export function AppErrorRecovery({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Decided once, during render: a stale-build error we have not already tried
  // to reload away from. Anything else (including the second failure in a row)
  // falls through to the panel.
  const [reloading] = useState(
    () =>
      isStaleBuildError(error) &&
      typeof window !== "undefined" &&
      !sessionStorage.getItem(RELOAD_FLAG),
  );

  useEffect(() => {
    if (!reloading) {
      // Either a real error or the retry already happened — clear the guard so
      // the next stale build gets its one reload.
      sessionStorage.removeItem(RELOAD_FLAG);
      return;
    }

    sessionStorage.setItem(RELOAD_FLAG, "1");
    window.location.reload();
  }, [reloading]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <h1 className="font-heading text-2xl font-extrabold text-foreground">
        {reloading ? "Loading the latest version…" : "Something went wrong"}
      </h1>
      {!reloading ? (
        <>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This page failed to load. Trying again usually fixes it.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              className="inline-flex h-11 items-center justify-center rounded-lg bg-brand-teal px-5 text-sm font-bold text-white transition hover:brightness-105"
              onClick={reset}
              type="button"
            >
              Try again
            </button>
            <button
              className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-5 text-sm font-bold text-foreground transition hover:bg-muted"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload page
            </button>
          </div>
          {error.digest ? (
            <p className="mt-6 text-xs text-muted-foreground">
              Reference: {error.digest}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
