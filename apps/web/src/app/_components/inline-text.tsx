"use client";

import { useEffect, useRef, type ClipboardEvent, type ElementType, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * A label edited where it is read.
 *
 * The Plans & Pricing admin screen renders the real public components — the
 * same plan cards, the same type scale, the same spacing — and lets the owner
 * type straight into them. That is the whole point of the screen: a pricing
 * card is a piece of writing whose line breaks and length matter, and a column
 * of text inputs above a preview shows neither. So every editable label on that
 * screen is one of these: it *is* the heading or the paragraph, with a tint on
 * hover to say it can be typed into.
 *
 * ## Why the value is written through a ref
 *
 * A `contentEditable` node whose children React re-renders loses the caret on
 * every keystroke — React replaces the text node, the browser puts the cursor
 * back at position zero, and the admin types their sentence backwards. So this
 * element is rendered empty and filled by the effect below, which writes only
 * when the DOM and the value actually differ. While the admin is typing they
 * never do (the input event has already pushed that exact string into state),
 * so nothing touches the node; a revert, a reload or an edit made elsewhere
 * does differ, and lands.
 *
 * Editing reports on `input` rather than on `blur` because the preview beside
 * the field has to move as the words do — a card that only updates when focus
 * leaves it is a form with extra steps.
 */
export function InlineText({
  as = "span",
  className,
  multiline = false,
  onChange,
  placeholder,
  value,
}: {
  as?: ElementType;
  className?: string;
  /** Lets Enter insert a line break instead of committing and blurring. */
  multiline?: boolean;
  onChange: (next: string) => void;
  placeholder?: string;
  value: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const Tag: ElementType = as;

  useEffect(() => {
    const node = ref.current;

    if (node && node.textContent !== value) {
      node.textContent = value;
    }
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!multiline && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  /**
   * Pasted rich text would arrive as markup and be stored as markup — these are
   * plain-string fields, so the clipboard is flattened on the way in. A paste
   * into a single-line field also loses its newlines rather than silently
   * storing a heading with a carriage return in the middle of it.
   */
  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");

    document.execCommand("insertText", false, multiline ? text : text.replace(/\s+/g, " "));
  }

  return (
    <Tag
      className={cn(
        "cursor-text rounded outline-none transition",
        "hover:bg-role-platform/10 focus:bg-role-platform/10 focus:ring-1 focus:ring-role-platform/40",
        // An empty field would otherwise be an invisible, unclickable nothing.
        "empty:min-w-[4ch] empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]",
        className,
      )}
      contentEditable
      data-placeholder={placeholder ?? "Empty"}
      onBlur={(event: { currentTarget: HTMLElement }) =>
        onChange(event.currentTarget.textContent ?? "")
      }
      onInput={(event: { currentTarget: HTMLElement }) =>
        onChange(event.currentTarget.textContent ?? "")
      }
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      ref={ref}
      role="textbox"
      spellCheck={false}
      suppressContentEditableWarning
      tabIndex={0}
    />
  );
}
