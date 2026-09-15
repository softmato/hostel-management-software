import type { Metadata } from "next";

import { PublicContactPage } from "@/app/_components/public-contact-page";
import { JsonLd } from "@/components/json-ld";
import { faqJsonLd } from "@/lib/json-ld";
import { staticPageMetadata } from "@/lib/seo-config";
import { loadSiteConfig } from "@/lib/site-config-server";
import { resolveWebFaq } from "@/lib/site-content";

export function generateMetadata(): Promise<Metadata> {
  return staticPageMetadata("contact");
}

export default async function ContactPage() {
  const { content, identity } = await loadSiteConfig();

  return (
    <>
      <JsonLd data={faqJsonLd(resolveWebFaq(content.faq, identity))} />
      <PublicContactPage />
    </>
  );
}
