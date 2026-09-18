"use client";

import { PublicShell } from "@/app/_components/shared";
import {
  ContentHeader,
  ContentIntro,
  ContentNote,
  ContentSectionIcon,
  LinkedEmails,
} from "@/components/content-sections";
import { useSiteConfig } from "@/components/site-config-provider";
import { resolveContentPage } from "@/lib/site-content";

/**
 * About Us. The values and the intro come from `content.about` in the site
 * config, so the page and the app's About screen say the same thing.
 *
 * The one difference from the legal pages: a value is a paragraph, not a
 * bulleted list, which is why this page draws its own rows rather than using
 * `ContentSections`. The stored shape is the same — `body` simply holds one
 * entry — so an owner editing them sees the same editor either way.
 */
export function PublicAboutPage() {
  const { content, identity, seo } = useSiteConfig();
  const page = resolveContentPage(content.about, identity);

  // "Palika" is an everyday Nepali word, so a search engine reads
  // "hostelpalika" as a misspelling of "hostel palika" and answers that instead.
  // The spellings are already declared as `alternateName` on the Organization
  // record, but that is markup — nothing a reader or a text query can match.
  // This is the one place the site writes them out, from the same owned list.
  const otherSpellings = seo.alternateNames.filter(
    (name) => name.toLowerCase() !== identity.siteName.toLowerCase(),
  );

  return (
    <PublicShell active="about">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <ContentHeader
          icon="building"
          subtitle={page.subtitle}
          title={`About ${identity.siteName}`}
        />

        <ContentIntro paragraphs={page.intro} />

        {otherSpellings.length > 0 ? (
          <section className="mb-14">
            <h2 className="mb-3 font-heading text-2xl font-bold text-foreground">
              The name
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {identity.siteName} is one word, from <em>hostel</em> and{" "}
              <em>palika</em>, the Nepali word for a municipality. It is also written{" "}
              {new Intl.ListFormat("en", { type: "disjunction" }).format(otherSpellings)}
              . Every one of those is this site.
            </p>
          </section>
        ) : null}

        <h2 className="mb-8 font-heading text-2xl font-bold text-foreground">
          Our Values
        </h2>
        <div className="space-y-10">
          {page.sections.map((section) => {
            return (
              <section key={section.title}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                    <ContentSectionIcon
                      className="size-4.5 text-primary"
                      slug={section.icon}
                    />
                  </span>
                  <h3 className="font-heading text-lg font-semibold text-foreground">
                    {section.title}
                  </h3>
                </div>
                <div className="ml-12 space-y-2">
                  {section.body.map((paragraph) => (
                    <p
                      className="text-sm leading-relaxed text-muted-foreground"
                      key={paragraph}
                    >
                      <LinkedEmails text={paragraph} />
                    </p>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <ContentNote body={page.noteBody} title={page.noteTitle} />
      </div>
    </PublicShell>
  );
}
