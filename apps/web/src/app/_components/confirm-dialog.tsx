"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ConfirmOptions = {
  /** Label on the button that goes ahead. Say what will happen, not "OK". */
  actionLabel?: string;
  cancelLabel?: string;
  description: string;
  /** `destructive` for anything that removes, revokes or cannot be undone. */
  tone?: "default" | "destructive";
  title: string;
};

type Resolver = (confirmed: boolean) => void;

/**
 * `window.confirm`, replaced.
 *
 * The native dialog is unstyled, ignores the theme, blocks the main thread and
 * cannot say more than one line — but its *shape* is the reason it kept getting
 * used: it returns a boolean right where the decision is made. This keeps that
 * shape and returns a promise instead, so a handler still reads
 * `if (!(await confirm({...}))) return;` while rendering a real
 * `AlertDialog` (focus-trapped, announced as `alertdialog`, and not dismissable
 * by a stray click on the overlay).
 *
 * ```tsx
 * const { confirm, confirmDialog } = useConfirm();
 * // …
 * if (!(await confirm({ title: "Delete post?", description: "…" }))) return;
 * // …
 * return <>{confirmDialog}…</>;
 * ```
 *
 * The promise resolves `false` on cancel, on Escape, and on unmount, so a
 * caller can never be left awaiting a dialog that is no longer on screen.
 */
export function useConfirm() {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  // The resolver lives only in a ref — it is not rendered, and keeping it out
  // of state means nothing is written to a ref during render.
  const resolverRef = useRef<Resolver | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPending(options);
    });
  }, []);

  // A caller awaiting a dialog that has left the screen would hang forever.
  useEffect(() => {
    return () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    };
  }, []);

  const settle = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const confirmDialog = (
    <AlertDialog
      onOpenChange={(open) => {
        // Covers Escape and any programmatic close, not just the Cancel button.
        if (!open) {
          settle(false);
        }
      }}
      open={pending !== null}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {pending?.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            variant={pending?.tone === "destructive" ? "destructive" : "default"}
          >
            {pending?.actionLabel ?? "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}
