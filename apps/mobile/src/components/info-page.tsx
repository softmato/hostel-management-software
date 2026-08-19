import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Linking, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { contentIcon } from "@/lib/site-content";

/**
 * The document layout the website uses for every page that is prose rather than
 * product: Privacy, Terms, About, Contact and the Resident Offer Program.
 *
 * On the web those five pages share one shape — a centred icon tile, a title, a
 * one-line subtitle, a hairline, a short intro, then sections that are each an
 * icon, a heading and a bulleted list, closing on a bordered note card. They are
 * built by copy-pasting that shape into each page component, which is why the
 * five have drifted apart in small ways (About indents its body as paragraphs
 * rather than bullets; Contact swaps the sections for cards and an accordion).
 *
 * Here it is one set of parts, because on a phone the drift is more expensive:
 * these screens are reached from a single list in the Profile tab, one after the
 * other, and a reader moving between them sees the inconsistency directly.
 *
 * ## Why bullets and not paragraphs
 *
 * The web renders each section's `content` array as `<li>`s with a dot. That is
 * not decoration — the copy is written as discrete claims ("Passwords are hashed
 * and salted", "One reading per day is retained") and running them together into
 * a paragraph makes a legal document that has to be read twice. Same list, same
 * dot, same order.
 */

/**
 * A masthead glyph, named directly. Screen chrome rather than content, so it is
 * an Ionicons name in the screen file and not a slug from the database.
 */
export type InfoIcon = keyof typeof Ionicons.glyphMap;

/**
 * One section as the site config stores it. `icon` is the platform's own slug —
 * `shield`, `receipt`, `map-pin` — resolved through `lib/site-content.ts`, not
 * an Ionicons name: the same slug has to mean the same thing to the website's
 * lucide set and to this one.
 */
/**
 * `bullets` for the legal and programme pages, whose copy is written as
 * discrete claims. `paragraphs` for About, where a value is one sentence and a
 * dot in front of it reads like a clause of a contract — which is exactly the
 * distinction the website draws between its two layouts.
 */
export type SectionVariant = "bullets" | "paragraphs";

export type InfoSectionData = {
  /** Rendered as a bulleted list, one entry per line. */
  body: string[];
  icon: string;
  title: string;
};

/**
 * The page's masthead. Centred, like the web's — these are documents, and a
 * left-aligned title on a screen with no navigation of its own reads as the
 * first row of a list rather than as a heading.
 */
export function InfoHeader({
  icon,
  subtitle,
  title,
}: {
  icon: InfoIcon;
  subtitle?: string;
  title: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="items-center gap-3 pb-2 pt-4">
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft">
        <Ionicons color={colors.primary} name={icon} size={26} />
      </View>

      <Text className="text-center" variant="title">
        {title}
      </Text>

      {subtitle ? (
        <Text className="text-center" variant="muted">
          {subtitle}
        </Text>
      ) : null}

      {/* The web's `h-px max-w-xs` rule under the subtitle. */}
      <View className="mt-1 h-px w-32 bg-border" />
    </View>
  );
}

/** The paragraphs between the masthead and the first section. */
export function InfoIntro({ paragraphs }: { paragraphs: string[] }) {
  return (
    <View className="gap-3">
      {paragraphs.map((paragraph) => (
        <Text className="leading-6" key={paragraph} variant="muted">
          <LinkedText>{paragraph}</LinkedText>
        </Text>
      ))}
    </View>
  );
}

/**
 * The stat strip the two partner landing pages carry — "500+ Hostels
 * Onboarded", "2 days review time".
 *
 * A grid rather than the website's single row: four stats side by side fit a
 * 1200dp page and not a 360dp one, and shrinking the numbers until they do is
 * how a stat strip stops being read.
 */
export function InfoHighlights({
  items,
}: {
  items: readonly { label: string; value: string }[];
}) {
  return (
    <View className="flex-row flex-wrap">
      {items.map((item) => (
        <View className="w-1/2 gap-0.5 py-3" key={item.label}>
          <Text variant="display">{item.value}</Text>
          <Text variant="caption">{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Any email address inside a run of stored copy, as a tappable `mailto:`.
 *
 * The support address is the *action* in every closing note — "Contact our Data
 * Protection team at …" — and on a phone that is even truer than on the web: an
 * address you have to memorise and retype into a mail app is an address nobody
 * writes to. Same treatment the Contact screen already gives the support card.
 *
 * **Brand green (`text-primary`), not blue.** Blue is a browser's default link
 * colour and it is nobody's brand here; every other accent on these screens —
 * the section icons, the bullet dots, the note border — is already `primary`, and
 * one blue word among them reads as a mistake rather than as emphasis. See
 * `ui-mockups-are-blue-theme-is-green`.
 *
 * Nested `<Text>` rather than a `Pressable`, because a pressable cannot sit
 * inside a line of text without breaking the line box — the address has to wrap
 * with the sentence it is part of.
 */
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

export function LinkedText({ children }: { children: string }) {
  // `split` with a capturing group keeps the matches, so the odd indices are the
  // addresses and the even ones the prose around them.
  const parts = children.split(new RegExp(`(${EMAIL_PATTERN.source})`, "gi"));

  if (parts.length === 1) {
    return <>{children}</>;
  }

  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Text
            className="font-medium text-primary"
            key={`${index}-${part}`}
            onPress={() => void Linking.openURL(`mailto:${part}`)}
          >
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** One dotted line of a section's list. */
function Bullet({ children }: { children: string }) {
  return (
    <View className="flex-row gap-3">
      <View className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40" />
      <Text className="flex-1 leading-6" variant="muted">
        <LinkedText>{children}</LinkedText>
      </Text>
    </View>
  );
}

/**
 * An icon, a heading, and the claims under it.
 *
 * The list is indented to clear the icon column (`pl-12` against the web's
 * `ml-12`), so the heading row and the body read as one block rather than two.
 */
export function InfoSection({
  body,
  icon,
  title,
  variant = "bullets",
}: InfoSectionData & { variant?: SectionVariant }) {
  const { colors } = useAppTheme();

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-brand-soft">
          <Ionicons color={colors.primary} name={contentIcon(icon)} size={18} />
        </View>
        <Text className="flex-1" variant="subtitle">
          {title}
        </Text>
      </View>

      <View className="gap-2.5 pl-12">
        {body.map((item) =>
          variant === "paragraphs" ? (
            <Text className="leading-6" key={item} variant="muted">
              <LinkedText>{item}</LinkedText>
            </Text>
          ) : (
            <Bullet key={item}>{item}</Bullet>
          ),
        )}
      </View>
    </View>
  );
}

/** Every section of a page, spaced the way the web spaces them. */
export function InfoSections({
  sections,
  variant = "bullets",
}: {
  sections: readonly InfoSectionData[];
  variant?: SectionVariant;
}) {
  return (
    <View className="gap-8">
      {sections.map((section) => (
        <InfoSection key={section.title} {...section} variant={variant} />
      ))}
    </View>
  );
}

/**
 * The bordered aside every one of these pages closes on — "Questions about this
 * policy?", "Not sure about a payment?", "Want to know more?".
 *
 * `tone="accent"` is the offer-program page's eligible state, which the web
 * draws in the primary colour rather than in muted grey because it is the one
 * card on the page that is about the reader.
 */
export function InfoNote({
  children,
  title,
  tone = "muted",
}: {
  children: ReactNode;
  title: string;
  tone?: "accent" | "muted";
}) {
  return (
    <View
      className={`gap-2 rounded-2xl border p-4 ${
        tone === "accent" ? "border-primary/30 bg-brand-soft" : "border-border bg-muted/40"
      }`}
    >
      <Text variant="subtitle">{title}</Text>
      {children}
    </View>
  );
}

/**
 * The plain-text legal copy an admin writes in Platform → Website Config →
 * Legal Pages, rendered the way `components/legal-body.tsx` renders it on the
 * web: lines starting with `#` are headings, `-` are bullets, everything else
 * is a paragraph. Blocks are separated by a blank line.
 *
 * Deliberately not markdown, for the same reason it is not markdown there — the
 * editor is a plain textarea and there is no sanitisation surface. Keeping the
 * two parsers in step matters more than either being clever: an owner writes
 * the document once and it has to read the same in both places.
 */
export function LegalBody({ body }: { body: string }) {
  const blocks = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <View className="gap-5">
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trim());
        const key = `${index}-${lines[0]}`;

        if (lines[0].startsWith("#")) {
          const heading = lines[0].replace(/^#+\s*/, "");
          const rest = lines.slice(1).filter(Boolean);

          return (
            <View className="gap-2" key={key}>
              <Text variant="subtitle">{heading}</Text>
              {rest.map((line) => (
                <Text className="leading-6" key={line} variant="muted">
                  <LinkedText>{line.replace(/^-\s*/, "")}</LinkedText>
                </Text>
              ))}
            </View>
          );
        }

        if (lines.every((line) => line.startsWith("-"))) {
          return (
            <View className="gap-2.5" key={key}>
              {lines.map((line) => (
                <Bullet key={line}>{line.replace(/^-\s*/, "")}</Bullet>
              ))}
            </View>
          );
        }

        return (
          <Text className="leading-6" key={key} variant="muted">
            <LinkedText>{block}</LinkedText>
          </Text>
        );
      })}
    </View>
  );
}
