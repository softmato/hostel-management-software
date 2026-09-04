import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { FLOAT_SHADOW, PaintedAmount, useAdminPaint } from "@/components/admin-shared";
import { NotificationBell } from "@/components/notification-bell";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { APP_NAME, APP_NAME_PARTS, logo } from "@/constants/branding";
import { roleAccent } from "@/constants/theme";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSystemInsets } from "@/hooks/use-system-insets";
import type { AdminHostel } from "@/lib/admin-api";
import {
  type EarningsSummary,
  heroAmountSize,
  heroPhotoUrl,
  hostelCode,
  type MonthDelta,
  occupancyLine,
  trendAxis,
  trendPoints,
  trendSegments,
  trendTickLabel,
  type TrendBar,
} from "@/lib/admin-home";
import { API_BASE_URL } from "@/lib/api";
import { formatMoney, maskMoney } from "@/lib/format";
import { absoluteMediaUrl } from "@/lib/media";

/**
 * The parts the admin Home screen is built out of.
 *
 * Split from the screen for the ordinary reason — `index.tsx` was becoming a
 * file where the shape of the page was buried under the drawing of it — and
 * because the pieces below are where the *visual* decisions live, while the
 * screen holds the data ones.
 *
 * ## Two colour systems on one screen, and where the line is
 *
 * Everything from the quick-action card downwards is a themed surface: palette
 * tokens, `bg-card`, `text-foreground`, and it inverts with the phone's theme.
 * The header and hero are **painted** — a coloured object the page scrolls
 * under, the way a bank card is — so their foreground is white in both schemes
 * and their literals are literals. A themed `foreground` up there would be
 * near-black in light mode: correct by the token, unreadable on the gradient.
 *
 * The one place this is easy to get wrong is a shared component landing on the
 * paint, which is why `IconButton` grew a `tone` rather than the header growing
 * its own bell.
 *
 * ## Measured sizes are written as styles, not as `text-[NNpx]`
 *
 * NativeWind compiles its class list from a build-time scan of the source, so an
 * arbitrary value appearing nowhere else in the app is absent from the generated
 * stylesheet until the bundler rebuilds — the class resolves to nothing and the
 * text renders at its default size, silently. `discovery-header.tsx` learnt this
 * the hard way and every measured dimension in this file follows it.
 */

/*
 * An `OVERLAP` / `HERO_FOOT` pair lived here: the quick actions were pulled 44
 * points up into a full-bleed hero that padded its own bottom by 62, so the card
 * straddled the gradient's edge.
 *
 * Both went when the hero became an inset card. Straddling needs an edge that
 * runs the full width of the screen — a card pulled up onto another card's
 * rounded corner is not the same gesture, it is two objects colliding. The
 * pattern is still the house style on screens that keep a painted band; this is
 * not one of them any more.
 */

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

/** The platform wordmark, in points. */
const WORDMARK = 22;

/** The logo mark beside it, sized to the wordmark's cap height. */
const MARK = 24;

/**
 * The fixed bar: whose product this is, and the bell.
 *
 * ## Why the platform sits above the hostel, and does not move
 *
 * Two identities are in play on this screen and they answer different
 * questions. *HostelHub* is the app you opened — it belongs to the chrome, it is
 * the same on every screen in every role, and the public side of the app has
 * always drawn it in exactly this spot. *Shanti Bhawan Residency* is the subject
 * of the page, one of possibly several a warden can see, and it belongs to the
 * content. Stacking them the other way round, or letting the platform name
 * scroll away, makes the app feel like it belongs to whichever hostel loaded.
 *
 * ## It stopped being painted, and that is what let the card become a card
 *
 * This bar was a flat fill of the gradient's first stop, joining seamlessly into
 * a full-bleed hero below it. The two together were one green mass from the
 * status bar to the quick actions — and a green card on a green ground is not a
 * card, it is a region. `ebl-01` is unambiguous about this: the bar is the page
 * background, the card is the only coloured object on the screen, and the
 * distance between those two facts is what makes the card read as something you
 * could pick up.
 *
 * So the bar takes `bg-background` and the wordmark takes the public header's
 * own foreground/brand pair, which is the lockup as designed rather than the
 * two-tones-of-white substitute the paint forced.
 *
 * ## The eye, and why it is sometimes not there
 *
 * Left of the bell is the one thing an owner cannot get to any other way: their
 * own listing, drawn by the same `hostel/[slug]` screen a stranger browsing the
 * app sees. Every other role already had this — a resident's dashboard has an
 * `open-outline` row to their hostel's page, and every card in Search opens it
 * — while the person who *writes* the listing had no way to look at it.
 *
 * It renders only when the caller hands over an `onPreview`, and the Home screen
 * only builds one when the listing is genuinely live. That is not caution:
 * `getPublicHostelBySlug` filters on `status: "PUBLISHED"` **and**
 * `verificationStatus: "VERIFIED"`, so an owner mid-application who taps this
 * gets a 404 screen reading "Hostel was not found" — which, to somebody waiting
 * on approval, reads as their hostel having been deleted. The hero's
 * `ListingPill` is already carrying the real answer in that state ("Awaiting
 * verification", "Not published yet"), so the honest move is to withhold a door
 * that does not open rather than to draw one that lies.
 */
export function AdminHomeHeader({
  /**
   * Opens the hostel's public page. Omitted — and the control hidden — when
   * there is no single hostel, or when its listing is not live. See above.
   */
  onPreview,
}: { onPreview?: () => void } = {}) {
  const { colors } = useAppTheme();
  const insets = useSystemInsets();

  return (
    <View className="bg-background" style={{ paddingTop: insets.top }}>
      <View className="min-h-14 flex-row items-center gap-2.5 px-5 pb-2 pt-1">
        <Image
          contentFit="contain"
          source={logo.mark}
          style={{ height: MARK, width: MARK }}
        />

        <View accessibilityLabel={APP_NAME} accessibilityRole="header" className="flex-1">
          <Text style={{ fontSize: WORDMARK, fontWeight: "800", letterSpacing: -0.4 }}>
            <Text style={{ color: colors.foreground }}>{APP_NAME_PARTS.head}</Text>
            <Text style={{ color: colors.primary }}>{APP_NAME_PARTS.tail}</Text>
          </Text>
        </View>

        {onPreview ? (
          /*
            An eye rather than a globe or a share arrow. Both of those promise
            to leave the app — `hostel-share.ts` builds a real `https://` URL
            for exactly that, and it is a different action — whereas this pushes
            a screen inside the app. The label says whose page it is, because
            "Preview" alone in a screen reader is a verb with no object.
          */
          <IconButton
            label="See your listing as visitors do"
            name="eye-outline"
            onPress={onPreview}
          />
        ) : null}

        <NotificationBell />
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * ## `/85` and `/15` are not opacities, they are nothing
 *
 * Twice now this card has shipped text the same colour as the page it was
 * painted on: `text-white/85` on the ID line, and `border-white/15` on the rule
 * above the two-up. Tailwind's opacity scale runs 5, 10, 20, 25, 30, 40, 50, 60,
 * 70, 75, 80, 90, 95, 100 — **15 and 85 are not on it**, NativeWind's build-time
 * scan emits no class for them, and the utility silently resolves to nothing.
 *
 * The failure is worse than a missing tint: with no colour class left, our
 * `<Text>` falls back to `variant="body"`, which is `text-foreground` — so the
 * line renders near-black on the accent and disappears. Every white on this card
 * is a step that exists, and a new one must be checked against that list before
 * it is typed.
 */

/**
 * This month against last, as a pill beside the section label.
 *
 * The only pill left on the hero. Three of them wrapped across the amount block
 * in the first cut, and a wrapping row of `shrink` chips is a truncation
 * machine: every chip gives up width to its neighbours until each one ellipses,
 * so `NPR 74,000 this month` became `NPR 74,0…` and the figures the hero exists
 * to show were the first thing lost. What those chips carried went to a fixed
 * two-up row, and then off the hero altogether — the month is the Money
 * section's subject and was being answered twice.
 *
 * This one survives as a pill because it is genuinely a *label*, not a figure —
 * it is short, bounded (`Up 99% on Sep` is the worst case), and it belongs
 * beside the heading it qualifies rather than under the number.
 *
 * The month's own figure came back, but as the right half of the fixed two-up
 * under the headline rather than as a chip beside it — see the note there. A
 * pill is the wrong container for a currency amount and always was.
 */
function DeltaPill({ delta }: { delta: MonthDelta }) {
  const icon =
    delta.direction === "up" ? "arrow-up" : delta.direction === "down" ? "arrow-down" : "remove";

  return (
    <View className="flex-row items-center gap-1 rounded-full border border-white/25 bg-white/20 px-2.5 py-1">
      <Ionicons color="rgba(255,255,255,0.9)" name={icon} size={11} />
      <Text className="font-semibold text-white" numberOfLines={1} style={{ fontSize: 11 }}>
        {delta.label}
      </Text>
    </View>
  );
}

/**
 * The one thing allowed to interrupt the hero.
 *
 * It sits **above the money**, which is the rule the previous Home already held
 * and the reason it is inside the gradient rather than in the body: the cost of
 * scrolling past this one is somebody's safety, so it may not be below anything,
 * and the body's first block is a screen further down.
 *
 * White on the gradient rather than red on it — a red panel on a saturated
 * teal-green ground is the one combination that loses its contrast, and the
 * white card is both louder and the only element on the hero that looks like it
 * came from a different, more urgent screen.
 *
 * It is an alarm, not the control. Acknowledging happens on the card in the body
 * below, which carries the resident, the message and the button.
 */
function HeroSosStrip({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`${count} SOS alerts active. Open the alerts queue.`}
      accessibilityRole="button"
      className="flex-row items-center gap-3 rounded-2xl bg-white px-3.5 py-3 active:opacity-80"
      onPress={() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onPress();
      }}
      style={FLOAT_SHADOW}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-[#fee2e2]">
        <Ionicons color="#dc2626" name="warning" size={18} />
      </View>

      <View className="flex-1">
        <Text className="text-sm font-semibold text-[#b91c1c]">
          {count === 1 ? "An SOS is active" : `${count} SOS alerts are active`}
        </Text>
        <Text className="text-[#7f1d1d]" style={{ fontSize: 11 }}>
          A resident is waiting for someone to respond
        </Text>
      </View>

      <Ionicons color="#b91c1c" name="chevron-forward" size={17} />
    </Pressable>
  );
}

/**
 * How much of the hostel's own photograph shows through the colour.
 *
 * Low on purpose. This is a *ground*, not a picture: white text at five sizes
 * sits on top of it, and every one of them stops being legible over a
 * photograph with its own bright and dark areas.
 *
 * It was 0.24, and on a device that is not texture — the windows are countable,
 * and the two-up figures land on whichever part of the facade happens to be
 * dark. `ebl-01` is the calibration: its mountain is a *ghost*, the card reads
 * as flat colour everywhere text sits, and you notice the photograph second. At
 * 0.11 you can still tell it is your building, which is the whole of what it is
 * there to do.
 */
const PHOTO_WEIGHT = 0.11;

/**
 * The card's geometry, measured off `ebl-01` rather than guessed.
 *
 * The reference screenshot is 576px wide, so every number in it converts by
 * `× 0.625` to points on a 360dp phone. What it gives:
 *
 * | | reference | here |
 * | --- | --- | --- |
 * | side margin | 23px → 14dp (4.0% of the screen) | `CARD_INSET` |
 * | card width | 529px → 331dp (92% of the screen) | whatever is left |
 * | corner | ~15px → 9dp | `CARD_RADIUS`, rounded up |
 * | padding | 24px → 15dp, 29px top, 23px bottom | `CARD_PAD` |
 * | height | 304px → 190dp | falls out of the content |
 *
 * The card was inset 20 and cornered at 26 — narrower than the reference and
 * twice as round, which is what made it read as a lozenge rather than as a bank
 * card. `AdminMoneyCard` keeps 26 for now; if these two ever need to match, this
 * is the measured one.
 */
const CARD_INSET = 14;

const CARD_RADIUS = 18;

const CARD_PAD = { paddingBottom: 18, paddingHorizontal: 16, paddingTop: 20 } as const;

/**
 * The gaps, and why they are this big.
 *
 * The first cut of this card was correct and unreadable: every row was right and
 * the whole thing was a brick. Measuring `ebl-01` says why — its rows sit **19,
 * 14, 28 and 27 points apart** ink to ink, and ours were between four and
 * twelve. A bank card is mostly air; that is the difference between a card you
 * glance at and a paragraph you parse.
 *
 * These are the CSS gaps that land on those ink gaps once line-height slack is
 * accounted for, so they read a few points tighter than the numbers above.
 */
const BLOCK_GAP = 20;

const LINE_GAP = 10;

/**
 * Pulls the money block up under the identity block.
 *
 * `PaintedAmount` runs a 1.45 line box so the device font's glyphs are not
 * clipped, and about half of that slack lands *above* the digits — so a 20-point
 * block gap measures 20 and reads as nearly 30. This cancels the leading rather
 * than shrinking `BLOCK_GAP`, which would also close up the gap above the rule,
 * where the space is doing its job.
 */
const AMOUNT_LEAD_TRIM = -9;

/**
 * Two soft discs bled off the edges — the fallback texture.
 *
 * A flat ramp behind six elements reads as a coloured rectangle, and every
 * payment card and banking home this screen is modelled on breaks that up
 * somehow. When the hostel has a photograph, the photograph does that job and
 * these would be competing with it, so they are drawn **only** when it has none.
 *
 * `pointerEvents: "none"` and outside the content flow, so nothing above them
 * moves; clipped by the card's `overflow: hidden`, which is also what keeps them
 * inside the rounded corners.
 */
function HeroOrnament() {
  return (
    <View className="absolute inset-0" style={{ pointerEvents: "none" }}>
      <View
        className="absolute rounded-full bg-white/10"
        style={{ height: 190, right: -60, top: -70, width: 190 }}
      />
      <View
        className="absolute rounded-full bg-white/5"
        style={{ bottom: -40, height: 130, left: -30, width: 130 }}
      />
    </View>
  );
}

/**
 * The listing's state, in the corner the account card keeps for it.
 *
 * `ebl-01` puts `Active` hard against the card's top-right, and it is the first
 * thing the eye reaches after the account's name — which is right, because a
 * card whose account is closed is a different card. Ours carries the same fact
 * about the public listing: a hostel sitting in `DRAFT` takes no inquiries at
 * all, and the screen this replaced reported that four sections down under
 * "Your listing", which is where you look once you already suspect something is
 * wrong.
 *
 * Live is a quiet translucent pill; anything else is solid white and reads as a
 * flag, because those are the two states that need different reactions.
 */
function ListingPill({ listing }: { listing: { live: boolean; note: string } }) {
  return (
    <View
      className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${
        listing.live ? "bg-white/25" : "bg-white"
      }`}
    >
      <View className={`h-1.5 w-1.5 rounded-full ${listing.live ? "bg-white" : "bg-[#b45309]"}`} />
      <Text
        className={`font-semibold ${listing.live ? "text-white" : "text-[#b45309]"}`}
        numberOfLines={1}
        style={{ fontSize: 10 }}
      >
        {listing.live ? "Live" : listing.note}
      </Text>
    </View>
  );
}

/**
 * The hostel as a bank account card: whose it is, its number, and its money.
 *
 * ## It is a card now, and that was the whole complaint
 *
 * This was a full-bleed painted band under a painted header — one green mass
 * from the status bar down to the quick actions, with the hostel's name in a
 * frosted panel inside it and three frosted tiles along its bottom. Every
 * element on it was correct and the object it added up to was not: a card is
 * something with edges, sitting on a ground that is not the same colour as it.
 *
 * `ebl-01` is the model, and it is four lines and a row:
 *
 * | EBL | here |
 * | --- | --- |
 * | `SAVINGS GENERAL` | the hostel's name |
 * | `08500501204444` | `hostelCode` — `HH-6F2A9C41` — and the area |
 * | `NPR 52.43` | everything collected, ever |
 * | `SIDDHANT YADAV` | residents, free beds, how full |
 * | `Actual` / `Available Balance` | `Since opening` / `This month` |
 *
 * Inset on all four sides with a shadow under it, `CARD_RADIUS` on every corner,
 * on a page background the header no longer paints over. The building's own
 * photograph is the card's ground at `PHOTO_WEIGHT`, which is the one thing EBL
 * does that this screen was already doing.
 *
 * ## Why the money still leads
 *
 * A hostel owner already knows what they collected this month — they set the
 * rent and they know how many residents they have. What they cannot get without
 * a laptop is the total: what this building has taken in since it opened. That
 * is the figure in 34-point type, `DeltaPill` answers "and is that good" in
 * words beside it, and the trend card in the body draws the rest.
 *
 * The two-up under it repeats that total on the left, which is deliberate and is
 * what EBL does: it *names* the big figure, and it makes the month beside it
 * read as a comparison rather than as a second unrelated number. It also earns
 * its place for a reason EBL does not have — a warden without `viewPayments`
 * gets no lifetime figure at all and the headline silently falls back to the
 * month, so `Since opening` reading `—` is the only thing that tells the two
 * cases apart. See `earningsSummary`.
 */
export function HostelHero({
  delta,
  earnings,
  hostel,
  listing,
  occupancy,
  onSos,
  residents,
  sosCount,
  vacantBeds,
}: {
  /** This month against last. Null in a first month — see `monthOverMonth`. */
  delta: MonthDelta | null;
  earnings: EarningsSummary;
  hostel: AdminHostel | null;
  listing: { live: boolean; note: string };
  /** Percent, or `null` when the hostel has never configured its rooms. */
  occupancy: number | null;
  onSos: () => void;
  residents: number;
  sosCount: number;
  vacantBeds: number;
}) {
  const paint = useAdminPaint();
  const photo = absoluteMediaUrl(heroPhotoUrl(hostel), API_BASE_URL);
  const code = hostelCode(hostel);
  const lifetimeKnown = earnings.lifetime !== null;
  /*
   * Hidden until asked for. The hero is the one screen an owner opens in a
   * corridor with residents standing next to them, and what it leads with is
   * everything the building has ever taken in — so the default is masked and
   * the eye is the only way to it. Component state, not persisted: the next
   * time the app is opened it is covered again, which is the behaviour every
   * banking app this screen is modelled on has.
   */
  const [shown, setShown] = useState(false);
  const real = formatMoney(lifetimeKnown ? earnings.lifetime : earnings.thisMonth);
  const amount = shown ? real : maskMoney(real);
  /*
   * Sized from whichever string is actually being drawn. Sizing off the real
   * figure would leave `NPR XXX.xx` set in the small type a seven-digit total
   * needs, and the headline would visibly change size on every toggle.
   */
  const size = heroAmountSize(amount);
  const money = (value: number | null) => {
    const formatted = formatMoney(value);

    return shown ? formatted : maskMoney(formatted);
  };

  return (
    <View style={{ paddingHorizontal: CARD_INSET }}>
      <LinearGradient
        /*
          Three stops, holding `from` flat for the first 45%: no colour travel at
          all over the half of the card the eye actually lands on — the name and
          the total — so the ramp supports the content instead of competing with
          it.
        */
        colors={[paint.from, paint.from, paint.to]}
        end={{ x: 0, y: 1 }}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 0 }}
        style={[FLOAT_SHADOW, { borderRadius: CARD_RADIUS, overflow: "hidden" }]}
      >
        {/*
          The hostel's own building, under the colour rather than beside it, and
          only when there is one — `HeroOrnament` is the alternative texture,
          never both.
        */}
        {photo ? (
          <>
            <Image
              contentFit="cover"
              source={{ uri: photo }}
              style={[StyleSheet.absoluteFill, { opacity: PHOTO_WEIGHT }]}
              transition={300}
            />
            {/*
              A darkening wash, faint at the top and strongest at the bottom
              where the smallest text on the card is. A photograph with a bright
              sky in its lower half is what takes a white 10-point label below
              the contrast floor, and it is not a case anybody would think to
              test for.
            */}
            <LinearGradient
              colors={["rgba(0,0,0,0.06)", "rgba(0,0,0,0.34)"]}
              end={{ x: 0, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </>
        ) : (
          <HeroOrnament />
        )}

        <View style={[CARD_PAD, { gap: BLOCK_GAP }]}>
          {/* Lines one and two: the account's name, its number, and its state. */}
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1" style={{ gap: LINE_GAP }}>
              <Text
                className="font-semibold text-white"
                numberOfLines={1}
                style={{ fontSize: 16 }}
              >
                {/*
                  A warden scoped to several hostels has no single profile to
                  name, and the figures below still cover all of them — so the
                  line widens rather than showing an empty one.
                */}
                {hostel?.name ?? "Your hostels"}
              </Text>

              <View className="flex-row items-center gap-1.5">
                <Ionicons
                  color="rgba(255,255,255,0.75)"
                  name={code ? "id-card-outline" : "albums-outline"}
                  size={12}
                />
                {/*
                  The account-number line. Tracked out a little, the way every
                  card prints the one string on it that a person has to read
                  aloud or copy by hand.
                */}
                <Text
                  className="flex-1 text-white/80"
                  numberOfLines={1}
                  style={{ fontSize: 13, letterSpacing: 0.5 }}
                >
                  {code ?? "Every hostel you manage"}
                </Text>
              </View>
            </View>

            <ListingPill listing={listing} />
          </View>

          {/*
            The one thing allowed to interrupt the card, and it sits above the
            money: the cost of scrolling past this one is somebody's safety, so
            it may not be below anything. It is an alarm, not the control —
            acknowledging happens on the card in the body below, which carries
            the resident, the message and the button.
          */}
          {sosCount > 0 ? <HeroSosStrip count={sosCount} onPress={onSos} /> : null}

          <View style={{ gap: LINE_GAP, marginTop: AMOUNT_LEAD_TRIM }}>
            <View className="flex-row items-end justify-between gap-2">
              {/*
                Sized from the string it is about to draw, with `NPR` a little
                under three-quarters of the digits — the treatment every balance
                in `ebl-01` and `ebl-02` gets. `PaintedAmount` owns that ratio
                and the Android `lineHeight` guard a figure this size needs.
              */}
              <View className="flex-1 flex-row items-center gap-2">
                <PaintedAmount size={size} value={amount} />

                {/*
                  Beside the figure, not in the card's corner: it is the control
                  *for this number*, and an owner who cannot find it reads a row
                  of Xs as a bug.
                */}
                <Pressable
                  accessibilityLabel={shown ? "Hide the amounts" : "Show the amounts"}
                  accessibilityRole="button"
                  className="-m-2 p-2 active:opacity-60"
                  hitSlop={8}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setShown((current) => !current);
                  }}
                >
                  <Ionicons
                    color="rgba(255,255,255,0.9)"
                    name={shown ? "eye-outline" : "eye-off-outline"}
                    size={17}
                  />
                </Pressable>
              </View>

              {/*
                Only when there is a comparison to make. A first month, and a
                month following a blank one, both return null rather than a
                percentage computed against zero.
              */}
              {delta ? <DeltaPill delta={delta} /> : null}
            </View>

            {/*
              The quiet line, in the slot the account holder's name occupies on
              `ebl-01`: three counts set as a caption rather than as figures,
              because not one of them is a thing to act on and all three were
              competing with the amount for the same glance. `occupancyLine`
              drops occupancy rather than printing `0%` for a hostel that has
              never configured its rooms.
            */}
            <View className="flex-row items-center gap-1.5">
              <Ionicons color="rgba(255,255,255,0.8)" name="people-outline" size={13} />
              <Text className="flex-1 text-white/80" numberOfLines={1} style={{ fontSize: 12 }}>
                {occupancyLine({ occupancy, residents, vacantBeds })}
              </Text>
            </View>
          </View>

          {/*
            **Fixed halves, never sized to content.** `flex-1` on both, not
            `shrink`: a wrapping row of content-sized chips gives width away to
            its neighbours until every one of them ellipses, which is how
            `NPR 74,000` became `NPR 74,0…` in an earlier cut. `AdminMoneyCard`
            draws the same pattern and carries the same note.
          */}
          {/*
            A drawn hairline, not `border-t border-white/15`.

            That class pair shipped a **black** rule across the card: NativeWind
            compiles its stylesheet from a build-time scan, the slashed border
            colour resolved to nothing, and what was left was a border width with
            React Native's default colour behind it. A `bg-white/20` view is the
            same hairline through the path that demonstrably works on this
            surface — the two-up's own divider is drawn the same way.
          */}
          <View style={{ gap: 14 }}>
            <View className="h-px w-full bg-white/20" />

            <View className="flex-row items-center">
              {[
                /*
                  Masked with the headline, by the same switch. The left half is
                  the same lifetime total the headline draws, so covering only
                  the big figure and printing it again in 16-point type two rows
                  below would hide nothing at all.
                */
                { label: "Since opening", value: money(earnings.lifetime) },
                { label: "This month", value: money(earnings.thisMonth) },
              ].map((fact, index) => (
                <View className="flex-1 flex-row items-center" key={fact.label}>
                  {index > 0 ? <View className="mr-3 h-9 w-px bg-white/25" /> : null}

                  <View className="flex-1 gap-1">
                    <Text
                      className="font-semibold uppercase tracking-wider text-white/75"
                      numberOfLines={1}
                      style={{ fontSize: 11 }}
                    >
                      {fact.label}
                    </Text>
                    <PaintedAmount size={16} value={fact.value} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick actions                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The four tints, one per action.
 *
 * A row of four identically-coloured tiles is read word by word; four colours
 * are recognised by position after about two uses, which is the entire point of
 * a shortcut row. They are the app's existing semantic tones rather than four
 * decorative ones — money is the money colour, the night roster is the warning
 * colour — so nothing here invents a fifth meaning for a colour used elsewhere.
 */
const ACTION_TONES = {
  admin: "bg-role-admin-soft",
  brand: "bg-brand-soft",
  danger: "bg-destructive-soft",
  success: "bg-success-soft",
  warning: "bg-warning-soft",
} as const;

/**
 * The white card both four-up rows sit in.
 *
 * There are two of them on Home now — the shortcuts and the queues — and they
 * are deliberately the same object: one bordered card, four evenly-spaced icon
 * cells, no dividers. It replaced a grid of four *separate* bordered tiles under
 * "Waiting for you", which put four card edges on the screen where the row above
 * had one, so two things that behave identically looked like different kinds of
 * thing.
 *
 * No padding of its own — the shortcut row supplies its own inset because it
 * sits outside the page's padded body, and the queue row is inside it.
 */
/** The card's own surface, shared by the single-row and multi-row shells. */
const ACTION_CARD = "rounded-3xl border border-border bg-card px-2 py-4";

/**
 * Cells per row, for every one of the three cards.
 *
 * Written once because it is one decision: the shortcut row, the queue row and
 * the Manage grid are the same object at three lengths, and a grid that quietly
 * used a different pitch from the rows above it would read as a second design.
 */
const COLUMNS = 4;

function ActionCard({ children }: { children: ReactNode }) {
  return (
    <View className={`flex-row items-start gap-1 ${ACTION_CARD}`} style={FLOAT_SHADOW}>
      {children}
    </View>
  );
}

/** Four evenly-spaced cells. `flex-1` each, so they shrink to fit the gap. */
function ActionRow({ children }: { children: ReactNode }) {
  return <View className="flex-row items-start gap-1">{children}</View>;
}

function QuickAction({
  badge,
  glyph,
  icon,
  label,
  onPress,
  onPressIn,
  tone,
}: {
  /**
   * A count on the glyph. Omit entirely for a cell that is a door rather than a
   * queue — `Today` has no single number meaning "how much of that is waiting",
   * and a cell with a count and a cell without read as different kinds of thing
   * at a glance, which is exactly what they are.
   */
  badge?: number;
  glyph: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /**
   * Touch-down, before the press resolves.
   *
   * Used for one thing only: starting the fetch the destination is about to
   * make. A finger resting on a tile is 100–300ms of head start, which is most
   * of the gap between tapping a tile and reading the screen behind it — and
   * unlike a launch-time warm-up it costs nothing for the tiles nobody touches.
   *
   * It must stay side-effect-free beyond that. This fires on a press that is
   * then dragged off and cancelled, so anything that *changes* something here
   * would happen without the user ever having chosen it.
   */
  onPressIn?: () => void;
  tone: keyof typeof ACTION_TONES;
}) {
  const quiet = badge === 0;

  return (
    <Pressable
      accessibilityLabel={[label, badge === undefined ? null : `${badge} waiting`]
        .filter(Boolean)
        .join(", ")}
      accessibilityRole="button"
      className="flex-1 items-center gap-2 active:opacity-70"
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      onPressIn={onPressIn}
    >
      <View className={`h-12 w-12 items-center justify-center rounded-2xl ${ACTION_TONES[tone]}`}>
        <Ionicons color={glyph} name={icon} size={21} />

        {/*
          On the glyph's shoulder, where every phone home screen has trained
          people to look for "how many" — and a zero goes grey whatever the tone,
          because a row of coloured pills reading `0` teaches people to ignore
          the colour on the day one of them is not.
        */}
        {badge === undefined ? null : (
          <View
            className={`absolute -right-1.5 -top-1.5 h-5 items-center justify-center rounded-full px-1.5 ${
              quiet ? "bg-muted" : "bg-destructive"
            }`}
            // A style rather than `min-w-[20px]` — see the note in `<CardRow>`.
            style={{ minWidth: 20 }}
          >
            <Text
              className={`font-bold ${quiet ? "text-muted-foreground" : "text-white"}`}
              style={{ fontSize: 11 }}
            >
              {badge}
            </Text>
          </View>
        )}
      </View>

      {/*
        Two lines are allowed and they are set tight. `Payments to check` does
        not fit one line in a quarter of the card, and at the class default's
        leading the wrapped word floated so far below the first line that the
        cell stopped reading as one label — 14 points closes it up and keeps
        every cell in the row the same height.
      */}
      <Text
        className="text-center font-medium text-foreground"
        numberOfLines={2}
        style={{ fontSize: 11, lineHeight: 14 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Everything else the hostel is run from, as one grid of doors.
 *
 * ## Why Home ends here rather than in six sections of figures
 *
 * The body under this used to be the rest of the product in longhand: a
 * collection card, a bar chart, a "still chasing" pair, tonight's roster and the
 * listing's view counts, each with a heading and a sentence under it. Every one
 * of those has a screen of its own that shows the same thing with room to
 * breathe — Money, Today, `manage/settings` — so Home was a summary of screens
 * you reach in one tap from the row above it, and it was three scrolls long.
 *
 * `ebl-01` and `esewa-01` both end their home the same way and it is the single
 * most consistent thing in the references: **a menu of destinations is a grid of
 * tinted glyphs with a short label**, never a stack of sections. What a home
 * screen is for is getting somewhere; the somewhere is where the detail lives.
 *
 * ## These are `more.tsx`'s rows, deliberately
 *
 * Same destinations, same icons, same order as the More tab — which sounds like
 * duplication and is the opposite. More is the exhaustive list with a sentence
 * of explanation on each; this is the same list with the explanations off, for
 * somebody who already knows where they are going. Diverging them would mean a
 * hostel owner learning two different maps of one product, so a tile added here
 * is a row added there in the same breath.
 *
 * **`Statement` is the one row with no tile here, and only on this screen.** It
 * sits four cells up under "Waiting for you", so a tile would be a second door
 * to it inside one scroll — the rule that took `Post notice` and
 * `Payments to check` off that row, applied in the other direction. More has no
 * "Waiting for you", so More keeps the row.
 */
export function ServiceGrid({
  onOpen,
  onPrefetch,
}: {
  onOpen: (href: string) => void;
  /**
   * Called on touch-down with the href about to be pushed.
   *
   * The grid knows the hrefs and nothing else — which query each one implies is
   * `lib/admin-queries.ts`'s business, so a tile added here without an entry
   * there simply loads the way it always did.
   */
  onPrefetch?: (href: string) => void;
}) {
  const { colors, scheme } = useAppTheme();

  const services = [
    { href: "/manage/finance", icon: "cash-outline", label: "Finance", tone: "success" },
    { href: "/(admin)/residents", icon: "people-outline", label: "Residents", tone: "admin" },
    /*
      Roll call came down from the shortcut row when the Store took its cell.

      It belongs in a grid of destinations rather than in a row of shortcuts, by
      the rule that row is chosen on: those four are jobs done *standing up*, and
      this is a roster somebody sits and reads top to bottom. It kept the moon
      and the amber it had, so anyone who learnt the glyph finds the same object
      one section lower — and the nightly path to it through Today is unchanged.

      Next to Residents deliberately: it is that list, at night.
    */
    { href: "/manage/roll-call", icon: "moon-outline", label: "Roll call", tone: "warning" },
    /*
      Came down from "Waiting for you" when the scanner took a shortcut slot and
      `Post notice` took its place there. It lands on Today rather than on a
      screen of its own because Today *is* the complaint queue — the section
      under the roll call is the whole of it, replies included.
    */
    {
      href: "/(admin)/today",
      icon: "chatbox-ellipses-outline",
      label: "Complaints",
      tone: "danger",
    },
    { href: "/manage/rooms", icon: "bed-outline", label: "Rooms", tone: "brand" },
    { href: "/manage/notices", icon: "megaphone-outline", label: "Notices", tone: "warning" },
    { href: "/manage/food", icon: "restaurant-outline", label: "Food", tone: "warning" },
    { href: "/manage/maintenance", icon: "construct-outline", label: "Repairs", tone: "danger" },
    { href: "/manage/reports", icon: "bar-chart-outline", label: "Reports", tone: "admin" },
    { href: "/manage/settings", icon: "settings-outline", label: "Settings", tone: "brand" },
  ] as const;

  const glyph = {
    admin: roleAccent.ADMIN[scheme],
    brand: colors.primary,
    danger: colors.destructive,
    success: colors.success,
    warning: colors.warning,
  } as const;

  /*
    Rows of four, chunked and written out — not `flex-wrap` over the whole list.

    Wrapping was the obvious construction and it shipped a card with its second
    row hanging *outside* the white surface: React Native's wrap does not grow
    the container to the height of the lines it created, so the card drew itself
    around the first four and the rest fell onto the page below it. Explicit rows
    are also the same construction as the shortcut and queue cards above, which
    is what keeps all three in step — and it is why the count is four here
    whatever length the list happens to be.
  */
  const rows: (typeof services)[number][][] = [];

  for (let index = 0; index < services.length; index += COLUMNS) {
    rows.push(services.slice(index, index + COLUMNS));
  }

  return (
    <View className={`gap-5 ${ACTION_CARD}`} style={FLOAT_SHADOW}>
      {rows.map((row) => (
        <ActionRow key={row[0].href}>
          {row.map((service) => (
            <QuickAction
              glyph={glyph[service.tone]}
              icon={service.icon}
              key={service.href}
              label={service.label}
              onPress={() => onOpen(service.href)}
              onPressIn={onPrefetch ? () => onPrefetch(service.href) : undefined}
              tone={service.tone}
            />
          ))}

          {/*
            Empty cells padding the short last row.

            Every cell is `flex-1`, so a row of one would draw a single tile
            stretched across the whole card — three times the width of the eight
            above it, and reading as a different kind of control rather than as
            the last item in a grid. The spacers keep the column pitch.
          */}
          {Array.from({ length: COLUMNS - row.length }, (_, index) => (
            <View className="flex-1" key={`gap-${index}`} />
          ))}
        </ActionRow>
      ))}
    </View>
  );
}

/**
 * The jobs a phone is genuinely better at than the portal.
 *
 * Straddles the hero's bottom edge, which does more than decorate: it pins the
 * row to the fold. These are the shortcuts somebody opens the app *for*, and a
 * screen where they sat below a metric grid taught people to scroll past the
 * metrics every single time.
 *
 * ## Three, and the rule that decides which three
 *
 * `Payments` and `Residents` came off, and the reason is the one that should
 * have kept them off in the first place: **both are bottom tabs**, sitting a
 * thumb-width below this row with a badge on them. A shortcut to something
 * already permanently on screen is not a shortcut, it is the same door drawn
 * twice — and the second drawing is the one without the count.
 *
 * That is the whole rule: **never a bottom tab, always something you would do
 * standing up.** Leading *into* a section the `Manage` grid below also maps is
 * fine and unavoidable — that grid is the full map of the product, the way
 * `More` is, and a shortcut that appears nowhere else would be a feature with
 * one entrance. Repeating one of its tiles verbatim is not: see today's menu
 * below.
 *
 * So: **the supply store**, `Add resident` with somebody in front of you
 * (`/manage/resident/new`) and **scanning a resident's card** in the corridor —
 * the three things that happen away from a desk. Recording cash would have been
 * the fourth and cannot be here at all: that write needs an invoice chosen
 * first, so it lives on the row's sheet inside Payments.
 *
 * ## Today's menu came off, and the cell was not refilled
 *
 * It was the `Food` tile of the grid below drawn a second time a scroll higher:
 * same icon, same destination, no count to tell the two apart. It also failed
 * the rule on its own merits — setting a menu is picking meals and times, read
 * and chosen sitting down, which is the reason `Post notice` moved down a card
 * before it.
 *
 * Three cells rather than a fourth thing promoted to fill the hole: they are
 * `flex-1` and simply space themselves, and this row is a list of what
 * qualifies, not a shape with four slots that must be full.
 *
 * ## The Store took roll call's cell
 *
 * Roll call was the first of these four and is now a tile in the `Manage` grid
 * below. It is a *roster* — every resident, read top to bottom — which is a
 * sitting-down job that was wearing a standing-up slot, and the nightly path to
 * it through Today never went away.
 *
 * The Store earns the cell on the same test the scanner does: ordering
 * mattresses happens while somebody is standing in the room that needs them, it
 * exists nowhere else in the app, and it is not a bottom tab. It leads the row
 * because it is the only one of the four that opens a whole section rather than
 * a single screen — and it takes `brand` with it, so the scanner moved to amber
 * rather than leaving two green cells two apart.
 *
 * ## A warden gets roll call in that cell instead
 *
 * The store's routes are `requireHostelAdminPrincipal` — buying supplies spends
 * the hostel's money, which is not what a warden's permission set is about — so
 * a warden tapping Store would get a 403 and no explanation. `onStore` is
 * therefore optional, and the cell falls back to roll call when it is absent.
 *
 * Not a greyed-out tile and not an empty cell: a warden's nightly job genuinely
 * *is* the roll call, so the row adapts to who is holding the phone rather than
 * showing them a door they cannot open. The caller decides — see
 * `(admin)/index.tsx` — because this component has no business reading a role.
 *
 * ## `Post notice` moved down a card, and the scanner took its slot
 *
 * Writing a notice is a **sitting-down** job — it wants an audience, a category,
 * a schedule and an expiry, all of which are on `manage/notices` — so it never
 * really met the rule this row is chosen by. It is now a cell in `Waiting for
 * you`, where the other doors without a count already live.
 *
 * The scanner is the opposite, and is the reason that rule exists: one-handed,
 * done standing up with somebody in front of you, and the single action
 * `NOTES.md` §10 records *both* reference apps putting behind the centre FAB of
 * their tab bar. That note said no admin action had earned a FAB; this one has
 * earned the strongest slot this row can give it.
 *
 * ## No badges, and why they were taken off
 *
 * Payments and Residents carried red counts of waiting claims and inquiries.
 * Both numbers were already on screen twice over: the **tab bar** badges Money
 * and Residents with them, and the tab bar is visible at the same moment as
 * this row — two copies of one number about forty points apart — while the
 * queue rows below print them a third time, itemised and in plain English.
 *
 * A count needs one home. The tab bar keeps it, because that badge survives the
 * user navigating away from Home, and the queue rows keep the explanation.
 * These are shortcuts: their job is to be reachable, not to report.
 */
export function QuickActions({
  onNewResident,
  onRollCall,
  onScan,
  onStore,
}: {
  onNewResident: () => void;
  /** The fallback for the lead cell when `onStore` is absent. */
  onRollCall: () => void;
  onScan: () => void;
  /** Omitted for a warden — see the note above. */
  onStore?: () => void;
}) {
  const { colors, scheme } = useAppTheme();

  return (
    <View className="px-5">
      <ActionCard>
        {onStore ? (
          <QuickAction
            glyph={colors.primary}
            icon="storefront-outline"
            label="Store"
            onPress={onStore}
            tone="brand"
          />
        ) : (
          <QuickAction
            glyph={colors.warning}
            icon="moon-outline"
            label="Roll call"
            onPress={onRollCall}
            tone="warning"
          />
        )}
        <QuickAction
          glyph={roleAccent.ADMIN[scheme]}
          icon="person-add-outline"
          label="Add resident"
          onPress={onNewResident}
          tone="admin"
        />
        <QuickAction
          glyph={colors.warning}
          icon="scan-outline"
          label="Scan resident"
          onPress={onScan}
          tone="warning"
        />
      </ActionCard>
    </View>
  );
}

/**
 * What is waiting, as one card of four rather than four cards of one.
 *
 * Identical in construction to the shortcut row above it, and that is the point:
 * these are destinations with a number on them, the row above is destinations
 * without, and they should differ by the number and by nothing else. The grid of
 * separate bordered tiles it replaces drew four card edges where the shortcuts
 * drew one, and the extra chrome was carrying no meaning.
 *
 * ## Counts come from the queues, never from the dashboard report
 *
 * `report.complaints` is every complaint the hostel has ever had, settled ones
 * included. Under a heading saying "waiting for you" that is quietly wrong in
 * the direction that makes an owner stop trusting the screen, so these read the
 * live queues — the same data the tab badges show.
 *
 * ## The row only holds what has no door elsewhere on Home
 *
 * Three cells came off it for that reason. Complaints went into the Manage grid
 * (they are also the largest section of `(admin)/today`, which the last cell
 * opens); `Post notice` went back to the Manage grid it is already a tile in;
 * and `Payments to check` went to the Money tab, which is a whole tab about
 * exactly that.
 *
 * ## Statement and Reconcile are two cells because they are two screens
 *
 * The cell labelled `Statement` opened `manage/statements`, which is the **bank
 * import** — while the Manage grid, one section below, carried a tile of the
 * same name opening `manage/finance/statement`, the hostel's own ledger of
 * credits. One word, two destinations, one scroll apart: whichever an owner
 * tapped first taught them the wrong thing about the other.
 *
 * Both halves of that are fixed here. `Statement` is now the ledger — the
 * figure an owner reaches for most often, so it gets the door on the row they
 * are already reading — and the import has the cell beside it under the name of
 * the job it actually does. The grid's tile came off in the same breath, by this
 * row's own rule: a cell here and a tile there are two doors to one room inside
 * a single scroll. `more.tsx` keeps its row, having no "Waiting for you".
 */
export function WaitingActions({
  inquiries,
  onInquiries,
  onReconcile,
  onStatement,
  onToday,
}: {
  inquiries: number;
  onInquiries: () => void;
  /** `manage/statements` — importing a bank or wallet export and matching it. */
  onReconcile: () => void;
  /** `manage/finance/statement` — the ledger of credits, day by day. */
  onStatement: () => void;
  onToday: () => void;
}) {
  const { colors, scheme } = useAppTheme();

  return (
    <ActionCard>
      {/*
        The ledger, wearing the glyph and the tone the Manage grid's tile wore
        before it came off — an owner who learnt the receipt in green finds the
        same object one section higher rather than a new one.
      */}
      <QuickAction
        glyph={colors.success}
        icon="receipt-outline"
        label="Statement"
        onPress={onStatement}
        tone="success"
      />
      {/*
        The bank import, under the name of the job rather than of the file.

        No badge: an import is something you *do*, not a queue that fills — the
        same reason `Today` below carries none. It keeps the amber the cell
        beside it used to have, so the row still reads left-to-right as "the
        money paperwork, then the people, then the day".
      */}
      <QuickAction
        glyph={colors.warning}
        icon="git-compare-outline"
        label="Reconcile"
        onPress={onReconcile}
        tone="warning"
      />
      <QuickAction
        badge={inquiries}
        glyph={roleAccent.ADMIN[scheme]}
        icon="mail-outline"
        label="New inquiries"
        onPress={onInquiries}
        tone="admin"
      />
      <QuickAction
        glyph={colors.success}
        icon="today-outline"
        label="Today"
        onPress={onToday}
        tone="success"
      />
    </ActionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Earnings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The plotted area, in points — the inside of the frame, not the whole block.
 *
 * 176, not the 112 it was drawn at first. A line chart is read by its *slope*,
 * and slope is the ratio of the plot's height to its width: at 112 points under
 * a card 300 wide, a month that doubled its takings still climbed at a shallow
 * angle, and the whole plot read as a strip of padding with a line in it. This
 * is roughly 3:5 on a 360dp phone, which is the shape the reference chart has.
 */
const CHART_HEIGHT = 176;

/**
 * The gutter down the left. Wide enough for `250k` at 10 points and no wider —
 * every point spent here is a point of slope lost from the plot.
 */
const AXIS_WIDTH = 32;

/** The line's own thickness, and the frame's. */
const LINE_WIDTH = 2;

/** Gridlines drawn between the ticks — five labels, four gaps. */
const SLICES = 4;

/**
 * The frame's border, in points. Absolutely-positioned children sit inside it,
 * so anything measured against the *outer* height has to allow for it.
 */
const FRAME = 1;

/**
 * Six months of collections, as a line on a scaled grid.
 *
 * ## Why a chart at all, on a screen that is otherwise figures
 *
 * "Collected this month" is a number with no scale attached — 74,000 is good or
 * bad depending entirely on what the last five months were, and that comparison
 * is the whole question behind "how is the hostel doing". Six months of shape
 * answer it without being read.
 *
 * ## A line, and the axis a line obliges
 *
 * This was six bars with no axis and no value labels, on the argument that
 * `NPR 74,000` will not fit in a 42-point column. That argument still holds and
 * nothing here breaks it — the per-month figures are still absent. What changed
 * is the mark: bars sized against each other are a comparison, while a line is
 * a *trajectory*, which is the thing an owner is actually looking for in six
 * months of rent. A line, though, cannot be read without knowing what its height
 * means, so the plot gets what the bars did not need: a rounded ceiling, four
 * gridlines under it, and short labels down the left (`0`, `20k`, `40k`). See
 * `trendAxis` for why the ceiling is rounded and never the peak itself.
 *
 * The month that matters keeps its figure in full above the plot, where there
 * is room for the currency code.
 *
 * ## Drawn out of `<View>`s, not SVG
 *
 * `react-native-svg` is not a dependency of this app and adding it is a native
 * rebuild for one chart, so the line is a row of thin views rotated to the angle
 * between each pair of points. That arithmetic is `trendPoints` and
 * `trendSegments`, in the library and tested — this file measures the box and
 * paints what they return.
 */
export function EarningsTrend({ bars }: { bars: readonly TrendBar[] }) {
  const { colors } = useAppTheme();

  /*
   * Measured, not assumed. The card this sits in is as wide as the phone minus
   * its padding, and the segment geometry is in points — so the line cannot be
   * laid out until the plot has been.
   *
   * Guarded the way `<Grid>` guards its own measurement: `onLayout` fires again
   * on every rotation and keyboard resize, and an unconditional `setState` in
   * that callback is a render loop on some Android devices.
   */
  const [plot, setPlot] = useState({ height: 0, width: 0 });

  if (bars.length === 0) {
    return null;
  }

  const best = bars.reduce((top, bar) => (bar.collected > top.collected ? bar : top));
  const latest = bars[bars.length - 1];
  const axis = trendAxis(bars, SLICES);
  const measured = plot.width > 0 && plot.height > 0;

  const points = trendPoints(bars, axis.ceiling, plot.width, plot.height);
  const segments = trendSegments(points, LINE_WIDTH);

  return (
    <View className="gap-2.5">
      {/*
        The figure the plot is the context for. It is stated here rather than on
        the line's last point because a label on the point would be the one value
        label on a chart that has none, and would move with the data.
      */}
      <View className="flex-row items-baseline justify-between">
        <Text variant="label">Collected</Text>
        <Text className="font-semibold">{formatMoney(latest.collected)}</Text>
      </View>

      <View className="flex-row">
        {/*
          The gutter and the plot both wait for the measurement — every mark in
          either is positioned in points computed from `plot`, so drawing them
          against a width of zero would stack five labels and five segments in
          one corner for a frame. `<Grid>` takes the same one-frame wait, and an
          empty frame is the honest intermediate state.
        */}
        <View style={{ height: CHART_HEIGHT, width: AXIS_WIDTH }}>
          {measured
            ? axis.ticks.map((tick, index) => (
                <Text
                  className="absolute right-1 text-right text-muted-foreground"
                  key={`tick-${index}`}
                  numberOfLines={1}
                  /*
                    Half a line-height above the rule it names, so the label is
                    centred on it rather than hanging under it. `FRAME` because
                    the rules are measured inside the plot's border and this
                    column has none.
                  */
                  style={{
                    fontSize: 10,
                    top: FRAME + (index * plot.height) / SLICES - 7,
                  }}
                >
                  {trendTickLabel(tick)}
                </Text>
              ))
            : null}
        </View>

        <View
          className="flex-1 overflow-hidden rounded-md"
          style={{
            borderColor: colors.border,
            borderWidth: FRAME,
            height: CHART_HEIGHT,
          }}
        >
          <View
            className="flex-1"
            onLayout={(event) => {
              const { height, width } = event.nativeEvent.layout;

              setPlot((current) =>
                Math.abs(current.width - width) > 0.5 ||
                Math.abs(current.height - height) > 0.5
                  ? { height, width }
                  : current,
              );
            }}
          >
            {measured ? (
              <>
                {/* Rules between the ticks, and one between each month. */}
                {axis.ticks.slice(1, -1).map((tick, index) => (
                  <View
                    key={`rule-${index}`}
                    style={{
                      backgroundColor: colors.border,
                      height: StyleSheet.hairlineWidth,
                      left: 0,
                      position: "absolute",
                      right: 0,
                      top: ((index + 1) * plot.height) / SLICES,
                    }}
                  />
                ))}

                {points.slice(1).map((point, index) => (
                  <View
                    key={`column-${bars[index + 1].period}`}
                    style={{
                      backgroundColor: colors.border,
                      bottom: 0,
                      left: (point.x + points[index].x) / 2,
                      position: "absolute",
                      top: 0,
                      width: StyleSheet.hairlineWidth,
                    }}
                  />
                ))}

                {segments.map((segment, index) => (
                  <View
                    key={`segment-${bars[index + 1].period}`}
                    style={{
                      backgroundColor: colors.primary,
                      borderRadius: LINE_WIDTH / 2,
                      height: LINE_WIDTH,
                      left: segment.left,
                      position: "absolute",
                      top: segment.top,
                      transform: [{ rotate: `${segment.angle}rad` }],
                      width: segment.width,
                    }}
                  />
                ))}

                {/*
                  One dot, on the last month. Six dots would be a scatter plot
                  with a line through it; one says which end is now — the job the
                  accented bar used to do.
                */}
                <View
                  style={{
                    backgroundColor: colors.primary,
                    borderColor: colors.card,
                    borderRadius: 5,
                    borderWidth: 2,
                    height: 10,
                    left: points[points.length - 1].x - 5,
                    position: "absolute",
                    top: points[points.length - 1].y - 5,
                    width: 10,
                  }}
                />
              </>
            ) : null}
          </View>
        </View>
      </View>

      {/* The month labels, under the plot and past the gutter. */}
      <View className="flex-row" style={{ paddingLeft: AXIS_WIDTH }}>
        {bars.map((bar) => (
          <Text
            className={`flex-1 text-center ${
              bar.latest ? "font-semibold text-foreground" : "text-muted-foreground"
            }`}
            key={bar.period}
            numberOfLines={1}
            style={{ fontSize: 11 }}
          >
            {bar.label}
          </Text>
        ))}
      </View>

      <Text variant="caption">
        {best.collected > 0
          ? `Best of these ${bars.length} months: ${best.label}, ${formatMoney(best.collected)}`
          : `Nothing has been collected in the last ${bars.length} months`}
      </Text>
    </View>
  );
}

/*
 * A `CollectionMeter` lived here: this month's figure in 24-point type, what was
 * billed in smaller type off to the right, and a `<Meter>` under the pair.
 *
 * `<DataCard>` does the same job in the same height and one more figure — the
 * month's shortfall, which was the subtraction every reader was performing
 * anyway — because three labelled columns side by side compare in a glance where
 * a large number above a small one does not. Its note about `null` being a state
 * rather than a zero survives in both `<Meter>` and `<DataCard>`; a hostel that
 * has billed nothing must never be shown an empty bar, which reads as having
 * collected nothing.
 */
