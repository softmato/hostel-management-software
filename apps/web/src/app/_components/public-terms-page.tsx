"use client";

import { PublicShell } from "@/app/_components/shared";
import {
  ContentHeader,
  ContentIntro,
  ContentNote,
  ContentSections,
} from "@/components/content-sections";
import { LegalBody } from "@/components/legal-body";
import { useSiteConfig } from "@/components/site-config-provider";
import { resolveContentPage } from "@/lib/site-content";

/**
 * Terms & Regulations. Same arrangement as the privacy page beside it: the
 * clauses live in `content.terms` in the site config, the shipped set is that
 * section's default, and `legal.terms.body` still replaces them with free text
 * for an owner whose lawyer hands them a document.
 */
export function PublicTermsPage() {
  const { content, identity, legal } = useSiteConfig();
  const page = resolveContentPage(content.terms, identity);
  const customBody = legal.terms.body.trim();

  return (
    <PublicShell active="terms">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <ContentHeader
          icon="scale"
          subtitle={`Last updated: ${legal.terms.updatedAt || "July 11, 2026"}`}
          title="Terms & Regulations"
        />

        <ContentIntro paragraphs={page.intro} />

        {customBody ? (
          <LegalBody body={customBody} />
        ) : (
          <ContentSections sections={page.sections} />
        )}

        <ContentNote body={page.noteBody} title={page.noteTitle} />
      </div>
    </PublicShell>
  );
}
