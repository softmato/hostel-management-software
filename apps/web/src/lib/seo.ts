import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Metadata } from "next";

import { PLATFORM_NAME } from "@hostel/shared/brand/brand";

/**
 * Search and social metadata, built one way for every public page.
 *
 * Next merges metadata shallowly, key by key: a page that sets `openGraph`
 * replaces the root layout's `openGraph` whole — `siteName` and `locale` with it.
 * So pages describe themselves (title, description, path) and this fills in the
 * brand, the canonical URL and the social card the same way everywhere.
 */

export const SEO_LOCALE = "en_NP";

export type PageSeo = {
  description: string;
  /** The small line above the title on the generated social card. */
  eyebrow?: string;
  /** A real photo — a hostel's cover — instead of the generated card. */
  image?: { alt?: string; url: string } | null;
  keywords?: string[];
  noindex?: boolean;
  /** Canonical path, starting with `/`. */
  path: string;
  /** Without the brand: the root title template appends ` · HostelPalika`. */
  title: string;
  /** The title already names the brand (the home page), so no template. */
  titleIsAbsolute?: boolean;
};

export function brandedTitle(title: string) {
  return `${title} · ${PLATFORM_NAME}`;
}

/** Collapses whitespace and cuts at a word boundary, for descriptions. */
export function snippet(value: string, max = 158) {
  const clean = value.replace(/\s+/g, " ").trim();

  if (clean.length <= max) {
    return clean;
  }

  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function pageMetadata(page: PageSeo): Metadata {
  // "About HostelPalika" already names the brand; appending it again reads as a mistake.
  const absolute = page.titleIsAbsolute || page.title.includes(PLATFORM_NAME);
  const fullTitle = absolute ? page.title : brandedTitle(page.title);
  const images = page.image?.url
    ? [{ alt: page.image.alt || page.title, url: page.image.url }]
    : [
        {
          alt: fullTitle,
          height: 630,
          url: ogImagePath(page.title, page.eyebrow),
          width: 1200,
        },
      ];

  return {
    alternates: { canonical: page.path },
    description: page.description,
    ...(page.keywords?.length ? { keywords: page.keywords } : {}),
    openGraph: {
      description: page.description,
      images,
      locale: SEO_LOCALE,
      siteName: PLATFORM_NAME,
      title: { absolute: fullTitle },
      type: "website",
      url: page.path,
    },
    ...(page.noindex ? { robots: NOINDEX } : {}),
    title: absolute ? { absolute: page.title } : page.title,
    twitter: {
      card: "summary_large_image",
      description: page.description,
      images: images.map((image) => image.url),
      title: { absolute: fullTitle },
    },
  };
}

/** One person's page, a single-use link, or a form step. Links out still count. */
export const NOINDEX = { follow: true, index: false } satisfies Metadata["robots"];

/** Signed-in portals: nothing in them is for a search engine, links included. */
export const PORTAL_ROBOTS = { follow: false, index: false } satisfies Metadata["robots"];

/*
 * ## Social cards
 *
 * `/og` draws the brand card with a page title on it. Left open, it would draw
 * any sentence anyone put in the query string under the HostelPalika name — a
 * ready-made fake announcement. So the title is signed when the page builds its
 * metadata, and the route draws unsigned or tampered text as the plain brand
 * card instead.
 */

const OG_CONTEXT = "og-image";
const OG_TITLE_MAX = 110;
const OG_EYEBROW_MAX = 40;

function ogSignature(title: string, eyebrow: string) {
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    return "";
  }

  return createHmac("sha256", secret)
    .update(`${OG_CONTEXT}:${title}\n${eyebrow}`)
    .digest("base64url")
    .slice(0, 22);
}

function clamp(value: string, max: number) {
  return snippet(value, max);
}

export function ogImagePath(title: string, eyebrow = "") {
  const t = clamp(title, OG_TITLE_MAX);
  const e = clamp(eyebrow, OG_EYEBROW_MAX);
  const signature = t ? ogSignature(t, e) : "";

  if (!signature) {
    return "/og";
  }

  const params = new URLSearchParams({ t });
  if (e) {
    params.set("e", e);
  }
  params.set("s", signature);

  return `/og?${params.toString()}`;
}

/** The text to draw, or `null` when the query was not signed by us. */
export function verifiedOgText(params: URLSearchParams) {
  const title = params.get("t") ?? "";
  const eyebrow = params.get("e") ?? "";
  const given = params.get("s") ?? "";

  if (!title || !given || title.length > OG_TITLE_MAX || eyebrow.length > OG_EYEBROW_MAX) {
    return null;
  }

  const want = ogSignature(title, eyebrow);

  if (!want || want.length !== given.length) {
    return null;
  }

  return timingSafeEqual(Buffer.from(want), Buffer.from(given)) ? { eyebrow, title } : null;
}
