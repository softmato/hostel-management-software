"use client";

import { Download, PlusSquare, Share, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { useSiteConfig } from "@/components/site-config-provider";

const DISMISS_KEY = "install-banner-dismissed";

type Platform = "android" | "ios" | null;

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The phone install nudge on the public site.
 *
 * Android gets the real app (Play listing, or the uploaded APK through
 * `/get-app`), and Chrome's own "install this website" prompt is swallowed so
 * nobody installs the lesser copy by accident. iPhone has no App Store build
 * yet, so it gets the website as an app: iOS has no install API, only the
 * Share → Add to Home Screen steps, which the sheet spells out. `?install=ios`
 * (the team's iPhone QR) opens that sheet straight away.
 */
export function InstallAppBanner() {
  const { apps, identity } = useSiteConfig();
  const [platform, setPlatform] = useState<Platform>(null);
  const [visible, setVisible] = useState(false);
  const [steps, setSteps] = useState(false);

  useEffect(() => {
    const agent = navigator.userAgent;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const detected: Platform = /iPhone|iPad|iPod/i.test(agent)
      ? "ios"
      : /Android/i.test(agent)
        ? "android"
        : null;
    const swallow = (event: Event) => event.preventDefault();

    window.addEventListener("beforeinstallprompt", swallow);

    if (detected && !standalone) {
      const asked = new URLSearchParams(window.location.search).get("install") === "ios";

      // One-shot sync from the browser environment after mount; not derivable during SSR.
      /* eslint-disable react-hooks/set-state-in-effect */
      setPlatform(detected);
      setVisible(asked || !readDismissed());
      setSteps(asked && detected === "ios");
      /* eslint-enable react-hooks/set-state-in-effect */
    }

    return () => window.removeEventListener("beforeinstallprompt", swallow);
  }, []);

  if (!platform || !visible) {
    return null;
  }

  function dismiss() {
    setVisible(false);
    setSteps(false);

    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private mode: the banner simply comes back next visit.
    }
  }

  const androidHref = apps.androidPlayUrl || "/get-app";

  return (
    <>
      <div className="fixed inset-x-3 bottom-3 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-xl">
        <Image alt="" className="size-10 shrink-0 rounded-xl" height={40} src="/icon.png" width={40} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-bold text-foreground">
            {platform === "android" ? `Get the ${identity.siteName} app` : `Install ${identity.siteName}`}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {platform === "android" ? "Free on Google Play" : "iPhone app coming soon"}
          </span>
        </span>
        {platform === "android" ? (
          <a
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-2 text-xs font-bold text-white"
            href={androidHref}
          >
            <Download className="size-3.5" /> Get
          </a>
        ) : (
          <button
            className="shrink-0 rounded-lg bg-brand-teal px-3 py-2 text-xs font-bold text-white"
            onClick={() => setSteps(true)}
            type="button"
          >
            Install
          </button>
        )}
        <button
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
          onClick={dismiss}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>

      {steps ? (
        <div
          className="fixed inset-0 z-[70] flex items-end bg-black/40"
          onClick={() => setSteps(false)}
          role="presentation"
        >
          <div
            aria-modal
            className="w-full rounded-t-3xl bg-card p-5 pb-8"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" />
            <p className="text-base font-bold text-foreground">
              Add {identity.siteName} to your Home Screen
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              It opens full screen, like an app. The iPhone app is coming soon.
            </p>
            <ol className="mt-4 space-y-3 text-sm text-foreground">
              <li className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                  <Share className="size-4" />
                </span>
                Tap <strong>Share</strong> in Safari&apos;s toolbar
              </li>
              <li className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                  <PlusSquare className="size-4" />
                </span>
                Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>
              </li>
            </ol>
            <button
              className="mt-5 h-11 w-full rounded-xl bg-brand-teal text-sm font-bold text-white"
              onClick={() => setSteps(false)}
              type="button"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
