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
 * The privacy policy.
 *
 * **The text is no longer here.** It lives in the site config, under
 * `content.privacy`, with the shipped document as that section's default — see
 * `site-config.defaults.ts`, which also carries the standing rule that every
 * line of it must describe something the code actually does. It moved because
 * the mobile app renders the same policy, and a platform cannot hold two
 * privacy policies and let the client decide which one you read.
 *
 * A platform admin authoring free text under Platform → Config → Legal still
 * replaces the structured sections outright; that is what `legal.privacy.body`
 * is for, and it is unchanged.
 */
export function PublicPrivacyPage() {
  const { content, identity, legal } = useSiteConfig();
  const page = resolveContentPage(content.privacy, identity);
  const customBody = legal.privacy.body.trim();

  return (
    <PublicShell active="privacy">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <ContentHeader
          icon="shield"
          subtitle={`Last updated: ${legal.privacy.updatedAt || "July 11, 2026"}`}
          title="Privacy Policy"
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
