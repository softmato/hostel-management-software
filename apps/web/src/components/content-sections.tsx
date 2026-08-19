"use client";

import { createElement, type ReactNode } from "react";

import { contentIcon } from "@/lib/site-content";

/**
 * The section list every prose page on the site draws: an icon, a heading, and
 * a bulleted list of claims under it.
 *
 * It used to be copy-pasted into `public-privacy-page`, `public-terms-page`,
 * `public-about-page` and `public-offer-program-page`, each with its own
 * hardcoded array beside it. The arrays moved into the site config (see
 * `contentSchema`); this is the markup they shared, extracted so the four pages
 * and the mobile app's `components/info-page.tsx` stay one design.
 */

/**
 * Draws a stored icon slug.
 *
 * `createElement` rather than `const Icon = contentIcon(slug); <Icon />` —
 * `react-hooks/static-components` reads a capitalised local bound to a call in a
 * render body as a component defined during render, which is the pattern that
 * remounts and loses state. These are stateless SVGs so nothing would actually
 * break, but the rule cannot know that, and silencing it per call site is worse
 * than one helper that never trips it.
 */
export function ContentSectionIcon({ className, slug }: { className: string; slug: string }) {
  return createElement(contentIcon(slug), { className });
}

export type RenderedSection = {
  body: string[];
  icon: string;
  title: string;
};

export function ContentIntro({ paragraphs }: { paragraphs: string[] }) {
  if (paragraphs.length === 0) {
    return null;
  }

  return (
    <div className="mb-14 space-y-4 text-sm leading-relaxed text-muted-foreground">
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </div>
  );
}

export function ContentSections({ sections }: { sections: RenderedSection[] }) {
  return (
    <div className="space-y-12">
      {sections.map((section) => {
        return (
          <section key={section.title}>
            <div className="mb-4 flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                <ContentSectionIcon className="size-4.5 text-primary" slug={section.icon} />
              </span>
              <h2 className="font-heading text-lg font-semibold text-foreground">
                {section.title}
              </h2>
            </div>
            <ul className="ml-12 space-y-2.5">
              {section.body.map((item) => (
                <li
                  className="flex items-start gap-3 text-sm leading-relaxed text-muted-foreground"
                  key={item}
                >
                  <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-primary/40" />
                  <span>
                    <LinkedEmails text={item} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Any email address in a run of stored copy, as a `mailto:` link.
 *
 * The support address is the *action* in every one of these closing notes —
 * "Contact our Data Protection team at …", "Reach out to our support team at …"
 * — and before the copy moved into the site config each page hardcoded it as an
 * `<a className="text-primary hover:underline">`. Flattening it to plain text
 * when the copy became configurable was a regression: the one thing the reader
 * is being told to do stopped being clickable.
 *
 * It is **`text-primary`, the brand green**, not blue. Blue is the web's default
 * link colour and it is nobody's brand here; every other accent on these pages
 * (the section icons, the bullet dots) is already `primary`, and one blue word in
 * the middle of them reads as a mistake. See docs/DESIGN.md — the mockups are
 * blue, the product is green.
 *
 * Matched rather than passed in, because the address comes from the copy: an
 * owner can write any mailbox into any note, and only some notes have one.
 */
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function LinkedEmails({ text }: { text: string }) {
  // `split` with a capturing group keeps the matches in the output array, so
  // the odd indices are the addresses and the even ones the prose around them.
  const parts = text.split(new RegExp(`(${EMAIL_PATTERN.source})`, "i"));

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a
            className="font-medium text-primary hover:underline"
            href={`mailto:${part}`}
            key={`${index}-${part}`}
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * The bordered aside these pages close on. Renders nothing when the owner has
 * cleared the body — an empty grey box says less than no box.
 */
export function ContentNote({
  body,
  children,
  className = "mt-16",
  title,
}: {
  body?: string;
  children?: ReactNode;
  className?: string;
  title: string;
}) {
  if (!body && !children) {
    return null;
  }

  return (
    <div
      className={`rounded-xl border border-border bg-muted/50 p-6 text-sm text-muted-foreground ${className}`}
    >
      <p className="font-semibold text-foreground">{title}</p>
      {body ? (
        <p className="mt-1">
          <LinkedEmails text={body} />
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** The centred masthead: icon tile, title, one-line subtitle, hairline. */
export function ContentHeader({
  icon,
  subtitle,
  title,
}: {
  icon: string;
  subtitle?: string;
  title: string;
}) {
  return (
    <div className="mb-16 text-center">
      <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
        <ContentSectionIcon className="size-7 text-primary" slug={icon} />
      </div>
      <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground">
        {title}
      </h1>
      {subtitle ? <p className="mt-3 text-muted-foreground">{subtitle}</p> : null}
      <div className="mx-auto mt-4 h-px max-w-xs bg-border" />
    </div>
  );
}
