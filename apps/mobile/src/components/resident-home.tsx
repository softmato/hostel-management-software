import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { NotificationBell } from "@/components/notification-bell";
import {
  FLOAT_SHADOW,
  HERO_AMOUNT_LEAD_TRIM,
  HERO_LINE_GAP,
  PaintedAmount,
  PortalHeroCard,
} from "@/components/portal-shared";
import {
  ActionCard,
  ActionCell,
  type ActionTile,
  ActionTiles,
} from "@/components/ui/action-grid";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";
import { APP_NAME, APP_NAME_PARTS, logo } from "@/constants/branding";
import { roleAccent } from "@/constants/theme";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSystemInsets } from "@/hooks/use-system-insets";
import { formatMoney, heroAmountSize, maskMoney } from "@/lib/format";
import type { StayPill } from "@/lib/resident-home";

/**
 * The parts the resident Home screen is built out of.
 *
 * ## It is the admin Home, with a resident's subject
 *
 * The two screens are now one design: a `bg-background` bar carrying the
 * platform lockup and the bell, a painted account card inset under it, a
 * shortcut row of tinted glyph cells, a card of queues with counts on them, and
 * a grid of doors that the screen ends on. `<PortalHeroCard>` and
 * `ui/action-grid.tsx` are literally the same components in both, so the two
 * cannot drift apart by a corner radius or a column pitch.
 *
 * What differs is what each card is *about*, which is the whole of the
 * difference between the two roles:
 *
 * | admin | here |
 * | --- | --- |
 * | the hostel's name | the hostel they live in |
 * | `HH-6F2A9C41`, the hostel's code | their room type and move-in date |
 * | is the listing live | did they check in tonight |
 * | everything collected, ever | everything they owe right now |
 * | residents / vacant / occupancy | which month, and how late |
 * | since opening / this month | outstanding / deposit held |
 *
 * ## The money is the other direction, and that is the one real divergence
 *
 * An owner's headline is income and there is nothing to *do* about it, so their
 * card carries no button. A resident's headline is a debt, and the app exists to
 * settle it — so this card has `Pay now` where the admin's has its month-on-month
 * pill, and it appears only when something is actually owed.
 *
 * ## Measured sizes are written as styles, not as `text-[NNpx]`
 *
 * NativeWind compiles its class list from a build-time scan of the source, so an
 * arbitrary value appearing nowhere else in the app is absent from the generated
 * stylesheet until the bundler rebuilds — the class resolves to nothing and the
 * text renders at its default size, silently. Every measured dimension in this
 * file follows `admin-home.tsx` in writing itself as a style.
 *
 * The same goes for **white opacities**: Tailwind's scale runs 5, 10, 20, 25,
 * 30, 40, 50, 60, 70, 75, 80, 90, 95, 100, and `/15` or `/85` resolve to nothing
 * at all — leaving our `<Text>` on `variant="body"`, which is `text-foreground`,
 * which is near-black on the paint. Two shipped bugs on the admin card came from
 * exactly that; every white here is a step that exists.
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
 * The admin bar, unchanged in construction and for the same reasons. *HostelHub*
 * is the app you opened — chrome, identical in every role — and the hostel is the
 * subject of the page, so it belongs on the card below rather than up here.
 *
 * ## What it replaced, and what was lost on purpose
 *
 * A greeting: `Good evening, Sujan`, with the hostel's name as a subtitle. It
 * read well and it spent the most valuable strip on the screen saying something
 * the resident already knows, on every single open. The hostel's name moved to
 * the card, where it is the identity the money belongs to; the greeting is gone.
 *
 * ## The eye
 *
 * Opens the hostel's public page — the same `hostel/[slug]` screen a stranger
 * browsing the app sees, and the row that used to be a chip on the hostel card.
 * It is only drawn when the caller has a slug to hand it.
 */
export function ResidentHomeHeader({
  onHostelPage,
}: { onHostelPage?: () => void } = {}) {
  const { colors } = useAppTheme();
  const insets = useSystemInsets();

  return (
    <View className="bg-background" style={{ paddingTop: insets.top }}>
      <View className="min-h-14 flex-row items-center gap-2.5 px-5 pb-2 pt-1">
        <Image contentFit="contain" source={logo.mark} style={{ height: MARK, width: MARK }} />

        <View accessibilityLabel={APP_NAME} accessibilityRole="header" className="flex-1">
          <Text style={{ fontSize: WORDMARK, fontWeight: "800", letterSpacing: -0.4 }}>
            <Text style={{ color: colors.foreground }}>{APP_NAME_PARTS.head}</Text>
            <Text style={{ color: colors.primary }}>{APP_NAME_PARTS.tail}</Text>
          </Text>
        </View>

        {onHostelPage ? (
          <IconButton
            label="Open your hostel's page"
            name="eye-outline"
            onPress={onHostelPage}
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
 * Tonight's answer, in the corner the account card keeps for its state.
 *
 * The admin card's `ListingPill` with a different fact behind it, and the same
 * two appearances for the same reason: **settled is a quiet translucent pill,
 * anything else is solid white and reads as a flag**, because those are the two
 * states that need different reactions.
 *
 * Pressable, which the admin's is not. A listing's state is something an owner
 * can only fix on another screen entirely; a night status is answered in one tap
 * on the screen this opens, so a flag that cannot be acted on would be the wrong
 * object here. `stayPill` decides which of the two it is.
 */
function StayStatePill({ onPress, pill }: { onPress: () => void; pill: StayPill }) {
  return (
    <Pressable
      accessibilityLabel={`${pill.label}. Open your night status.`}
      accessibilityRole="button"
      className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 active:opacity-70 ${
        pill.settled ? "bg-white/25" : "bg-white"
      }`}
      hitSlop={6}
      onPress={onPress}
    >
      <View
        className={`h-1.5 w-1.5 rounded-full ${pill.settled ? "bg-white" : "bg-[#b45309]"}`}
      />
      <Text
        className={`font-semibold ${pill.settled ? "text-white" : "text-[#b45309]"}`}
        numberOfLines={1}
        style={{ fontSize: 10 }}
      >
        {pill.label}
      </Text>
    </Pressable>
  );
}

/**
 * The one thing allowed to interrupt the card.
 *
 * The admin hero's SOS strip, in the slot it occupies and under the same rule:
 * it sits **above the money**, inside the paint, so it cannot be scrolled past.
 * An urgent notice is the resident's version of that — the hostel marks a notice
 * urgent when it is about water going off, a gate closing early or an inspection
 * tomorrow, and those are worthless read a day late.
 *
 * White on the gradient rather than amber on it: a tinted panel on a saturated
 * green ground is the one combination that loses its contrast, and the white
 * card is the only element on the paint that looks like it came from somewhere
 * more urgent.
 */
function UrgentNoticeStrip({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`${count} urgent notices. Open notices.`}
      accessibilityRole="button"
      className="flex-row items-center gap-3 rounded-2xl bg-white px-3.5 py-3 active:opacity-80"
      onPress={() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onPress();
      }}
      style={FLOAT_SHADOW}
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-[#fef3c7]">
        <Ionicons color="#b45309" name="megaphone" size={18} />
      </View>

      <View className="flex-1">
        <Text className="text-sm font-semibold text-[#92400e]">
          {count === 1 ? "An urgent notice is up" : `${count} urgent notices are up`}
        </Text>
        <Text className="text-[#78350f]" style={{ fontSize: 11 }}>
          Your hostel needs you to read this today
        </Text>
      </View>

      <Ionicons color="#92400e" name="chevron-forward" size={17} />
    </Pressable>
  );
}

/**
 * The card's action, on the themed half rather than on the paint.
 *
 * It started as a small white pill beside the figure, in the slot the admin card
 * gives its month-on-month pill — which made the two cards the same object with
 * one extra chip, and made the single thing this screen exists for the smallest
 * control on it. Down here it is a filled brand button on a `bg-card` surface,
 * which is what it would be anywhere else in the app.
 *
 * Two labels, because it is two different actions. Owing something, it settles a
 * debt; owing nothing, it opens a history — and a `Pay now` on a zero balance is
 * how somebody ends up paying next month's rent twice.
 */
function HeroAction({ onPress, owes }: { onPress: () => void; owes: boolean }) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={owes ? "Pay what you owe" : "Open your payments"}
      accessibilityRole="button"
      className={`flex-row items-center gap-1.5 rounded-full px-4 py-2.5 active:opacity-80 ${
        owes ? "bg-primary" : "border border-border bg-card"
      }`}
      hitSlop={6}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
    >
      <Ionicons
        color={owes ? "#ffffff" : colors.mutedForeground}
        name={owes ? "card" : "time-outline"}
        size={14}
      />
      <Text
        className={`font-bold ${owes ? "text-white" : "text-foreground"}`}
        numberOfLines={1}
        style={{ fontSize: 13 }}
      >
        {owes ? "Pay now" : "Payments"}
      </Text>
    </Pressable>
  );
}

/**
 * The stay as a rent card: where they live, and what is left to pay on it.
 *
 * ## Two registers, which is what stops it being the warden's card
 *
 * The first cut of this was `HostelHero` with a resident's data poured into it —
 * same paint, same four blocks, same hairline two-up — and on a device the two
 * home screens were one screen with different numbers on it. A resident and the
 * person who bills them should not be looking at the same object.
 *
 * So this one is **paint over a themed surface**, which is `NOTES.md` §11
 * (`esewa-07`, `esewa-08`): the subject on colour, and a second register below a
 * rule carrying the position and one action. Nothing in the app used that split
 * yet, and it is exactly the one this card wants — what you owe is the hostel's
 * number; what you do about it is yours.
 *
 * | painted | themed footer |
 * | --- | --- |
 * | the hostel's name, and tonight's answer | `Deposit held` |
 * | their room type, and the day they moved in | `Pay now` |
 * | `REMAINING TO PAY` over the figure | |
 * | which month it is, and how late | |
 *
 * ## The figure is labelled, and that is why it is printed once
 *
 * The admin card leads with an unlabelled total and *names* it in the two-up
 * below — which is what `ebl-01` does, and why `Outstanding` used to sit under
 * `NPR 18,800` carrying the same `NPR 18,800`. Here the label is above the
 * figure instead, in the small caps the reference gives every figure it names,
 * so the fact is stated once and the footer is free to carry the deposit and the
 * button rather than a repeat.
 *
 * ## What it replaced
 *
 * A `DuesCard` (a bordered white card with the amount, a status pill, a due
 * label and a full-width button), a `StatStrip` of three metric tiles, and a
 * `HostelCard` with a photo thumbnail and a wrap of contact chips — three
 * objects, three surfaces, about two thirds of the first screenful. Every fact
 * they carried is still on this screen; the photo became the card's ground, the
 * three tiles became the queue row, and the contact chips became a shortcut that
 * dials.
 *
 * ## The deposit
 *
 * A resident's second figure, and the one they can never find: it is money of
 * theirs the hostel is holding, it is on the dashboard payload already, and
 * before this it appeared on no mobile screen at all. It is masked with the
 * headline by the same switch — covering the amount you owe while printing the
 * amount you have on deposit two rows below would hide nothing worth hiding.
 */
export function ResidentStayHero({
  deposit,
  dueAmount,
  duesNote,
  hostelName,
  onNotices,
  onNightStatus,
  onPay,
  photoUrl,
  roomLabel,
  sinceLabel,
  stay,
  urgentCount,
}: {
  /** `resident.depositAmount` — theirs, held by the hostel. */
  deposit: number;
  dueAmount: number;
  /** One line under the figure — `duesLine`, which owns the priority order. */
  duesNote: string;
  hostelName: string | null;
  onNightStatus: () => void;
  onNotices: () => void;
  onPay: () => void;
  photoUrl: string | null;
  /** `Single room` — humanized, without the word "room" doubled. */
  roomLabel: string;
  /** The move-in date, already in the reader's calendar. No `Since` prefix. */
  sinceLabel: string;
  stay: StayPill;
  urgentCount: number;
}) {
  /*
   * Hidden until asked for, exactly as on the admin card. A resident opens this
   * in a common room with three other people on the sofa, and what it leads with
   * is what they owe — which is nobody else's business. Component state, not
   * persisted: it is covered again next launch, which is what every banking app
   * this card is modelled on does.
   */
  const [shown, setShown] = useState(false);
  const real = formatMoney(dueAmount);
  const amount = shown ? real : maskMoney(real);
  /*
   * Sized from whichever string is actually being drawn. Sizing off the real
   * figure would leave `NPR XXX.xx` set in the small type a six-digit figure
   * needs, and the headline would visibly change size on every toggle.
   */
  const size = heroAmountSize(amount);
  const money = (value: number) => {
    const formatted = formatMoney(value);

    return shown ? formatted : maskMoney(formatted);
  };

  const owes = dueAmount > 0;

  return (
    <PortalHeroCard
      footer={
        /*
          The second register. `bg-card`, ordinary tokens, and the one control on
          the card — see `<PortalHeroCard>`'s `footer` note for why it bleeds to
          the card's edges rather than sitting in the padded block above.
        */
        <View className="flex-row items-center justify-between gap-3 px-4 py-3.5">
          <View className="flex-1 gap-1">
            <Text
              className="font-semibold uppercase tracking-wider text-muted-foreground"
              numberOfLines={1}
              style={{ fontSize: 10 }}
            >
              Deposit held
            </Text>
            <Text
              className="font-semibold text-foreground"
              numberOfLines={1}
              style={{ fontSize: 15 }}
            >
              {money(deposit)}
            </Text>
          </View>

          <HeroAction onPress={onPay} owes={owes} />
        </View>
      }
      photoUrl={photoUrl}
    >
      {/* Lines one and two: where they live, and on what terms. */}
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1" style={{ gap: HERO_LINE_GAP }}>
          <Text className="font-semibold text-white" numberOfLines={1} style={{ fontSize: 16 }}>
            {hostelName ?? "Your hostel"}
          </Text>

          {/*
            The account-number block — what a resident is asked at the office:
            which room, since when.

            **Two rows, each with its own glyph**, rather than one string joined
            by a `·`. Joined, it did not fit beside the state pill on a 360dp
            phone: it came back from the device first as `Since Bhadra 19, 2…`
            with the year cut off, and then wrapping in the middle of the date,
            so `2083 BS` sat alone on a second line under a bed icon. There is no
            short form of a BS date to fall back on, so the two facts get a row
            each and the calendar glyph says which is which.
          */}
          <View className="gap-1.5">
            {[
              { icon: "bed-outline", text: roomLabel },
              { icon: "calendar-outline", text: `Since ${sinceLabel}` },
            ].map((row) => (
              <View className="flex-row items-center gap-1.5" key={row.icon}>
                <Ionicons
                  color="rgba(255,255,255,0.75)"
                  name={row.icon as keyof typeof Ionicons.glyphMap}
                  size={12}
                />
                <Text
                  className="flex-1 text-white/80"
                  numberOfLines={1}
                  style={{ fontSize: 13, letterSpacing: 0.3 }}
                >
                  {row.text}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <StayStatePill onPress={onNightStatus} pill={stay} />
      </View>

      {urgentCount > 0 ? (
        <UrgentNoticeStrip count={urgentCount} onPress={onNotices} />
      ) : null}

      <View style={{ gap: 6, marginTop: HERO_AMOUNT_LEAD_TRIM }}>
        {/*
          The label the admin card does not have, and the reason this figure is
          printed once rather than twice — see the note at the top.
        */}
        <Text
          className="font-semibold uppercase tracking-wider text-white/75"
          numberOfLines={1}
          style={{ fontSize: 11 }}
        >
          Remaining to pay
        </Text>

        <View className="flex-row items-center gap-2">
          <PaintedAmount size={size} value={amount} />

          {/*
            Beside the figure, not in the card's corner: it is the control *for
            this number*, and somebody who cannot find it reads a row of Xs as a
            bug.
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
          One sentence about the figure above it, chosen by `duesLine` — which
          puts a claim in review ahead of everything, because telling somebody
          who has already paid that they are four days overdue is the one thing
          this line can say that costs them money.
        */}
        <View className="mt-1.5 flex-row items-center gap-1.5">
          <Ionicons color="rgba(255,255,255,0.8)" name="receipt-outline" size={13} />
          <Text className="flex-1 text-white/80" numberOfLines={1} style={{ fontSize: 12 }}>
            {duesNote}
          </Text>
        </View>
      </View>
    </PortalHeroCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick actions                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The jobs a phone is genuinely better at than a laptop, pinned to the fold.
 *
 * The admin row's rule, applied to a resident: **never a bottom tab, always
 * something you would do standing up.** Payments, Community, Food and More are
 * tabs a thumb-width below this card, and a shortcut to something permanently on
 * screen is the same door drawn twice.
 *
 * So the three that are left are the three that happen away from a desk:
 *
 * - **Digital ID** — produced at a gate, at a counter, to a warden who does not
 *   recognise you. It is the single most phone-shaped thing a resident owns.
 * - **Call hostel** — one tap to the office, from a card that previously made
 *   you read the number off a chip and type it into the dialler. `tel:` rather
 *   than a screen, which is the whole point.
 * - **Raise issue** — `complaints/new`, opened with the broken tap in front of
 *   you and the camera in your hand. The *queue* of complaints is a cell in the
 *   card below; composing one is a different verb and a different moment, the
 *   same way `Add resident` and `New inquiries` are two cells on the admin Home.
 *
 * ## SOS is not here, and must not be added
 *
 * `<SosFab>` is mounted outside the navigator in `(resident)/_layout.tsx`, so it
 * is on screen on every resident tab and survives tab changes mid-countdown. A
 * fourth cell repeating it would be a second, quieter alarm — and the one that
 * scrolls away.
 *
 * ## A resident with no hostel phone number gets two cells
 *
 * `onCall` is optional and the cell simply does not draw. They are `flex-1` and
 * space themselves; this row is a list of what qualifies, not a shape with slots
 * that have to be filled.
 */
export function ResidentQuickActions({
  onCall,
  onIdCard,
  onRaiseIssue,
}: {
  /** `tel:` the hostel. Omitted when the listing carries no phone number. */
  onCall?: () => void;
  onIdCard: () => void;
  onRaiseIssue: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="px-5">
      <ActionCard>
        <ActionCell
          glyph={colors.primary}
          icon="card-outline"
          label="Digital ID"
          onPress={onIdCard}
          tone="brand"
        />

        {/*
          Amber and red rather than two more greens. `roleAccent.RESIDENT` and
          `colors.success` are the **same hex** in light mode (`#16a34a`), so a
          row tinted by role would have drawn three cells the eye cannot tell
          apart — and a row of four colours recognised by position is the entire
          reason these cells are tinted at all.
        */}
        {onCall ? (
          <ActionCell
            glyph={colors.warning}
            icon="call-outline"
            label="Call hostel"
            onPress={onCall}
            tone="warning"
          />
        ) : null}

        <ActionCell
          glyph={colors.destructive}
          icon="create-outline"
          label="Raise issue"
          onPress={onRaiseIssue}
          tone="danger"
        />
      </ActionCard>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Waiting for you                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What is waiting, as one card of four rather than three metric tiles.
 *
 * Identical in construction to the shortcut row above it, and that is the point:
 * these are destinations with a number on them, the row above is destinations
 * without, and they differ by the number and by nothing else.
 *
 * ## It replaced the `StatStrip`, and kept only the counts that mean something
 *
 * That strip drew three `<StatTile>`s — Notices, Complaints, Night status — each
 * carrying a value, a label *and* a trend line ("Nothing urgent", "All
 * resolved", "Checked 2 days ago"). Three sentences of reassurance, in the
 * second-most valuable band on the screen, on a screen where the thing a
 * resident came for is above them.
 *
 * The counts survive as badges; the reassurance does not. A cell reading nothing
 * is a cell with a grey `0` on it, which says the same thing in a glance.
 *
 * ## Notices counts the urgent ones, not the unread ones
 *
 * `serializeNotice` emits no `isRead` field, so `!notice.isRead` is true for
 * every notice and the web marks all of them new. Repeating that here would be
 * repeating a bug. `isUrgent` is a field the serializer does emit, and it is the
 * one worth counting anyway — the unread count comes back the day the serializer
 * carries the flag.
 *
 * ## Night status is a door, and carries no count
 *
 * There is no number that means "how much of tonight is waiting". It is a cell
 * without a badge for the same reason `Today` is on the admin card, and the
 * hero's pill above already says which of the two states it is in.
 */
export function ResidentWaitingActions({
  complaints,
  invoices,
  onComplaints,
  onInvoices,
  onNightStatus,
  onNotices,
  urgentNotices,
}: {
  /** Still open. */
  complaints: number;
  /** `feeStatus.unpaidCount` — invoices, not rupees. */
  invoices: number;
  onComplaints: () => void;
  onInvoices: () => void;
  onNightStatus: () => void;
  onNotices: () => void;
  urgentNotices: number;
}) {
  const { colors } = useAppTheme();

  return (
    <ActionCard>
      <ActionCell
        badge={invoices}
        glyph={colors.success}
        icon="receipt-outline"
        label="Invoices"
        onPress={onInvoices}
        tone="success"
      />
      <ActionCell
        badge={urgentNotices}
        glyph={colors.warning}
        icon="megaphone-outline"
        label="Notices"
        onPress={onNotices}
        tone="warning"
      />
      {/*
        Red, the tone the admin grid's `Complaints` tile wears — so the two
        people either side of one complaint find it under the same colour.
      */}
      <ActionCell
        badge={complaints}
        glyph={colors.destructive}
        icon="chatbox-ellipses-outline"
        label="Complaints"
        onPress={onComplaints}
        tone="danger"
      />
      <ActionCell
        glyph={colors.primary}
        icon="moon-outline"
        label="Night status"
        onPress={onNightStatus}
        tone="brand"
      />
    </ActionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Your stay                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Everything else, as one grid of doors — and where Home ends.
 *
 * ## These are `more.tsx`'s rows, deliberately
 *
 * Same destinations, same icons, same order as the More tab, which sounds like
 * duplication and is the opposite. More is the exhaustive list with a sentence
 * of explanation on each; this is the same list with the explanations off, for
 * somebody who already knows where they are going. Diverging them would mean a
 * resident learning two maps of one product, so a tile added here is a row added
 * there in the same breath.
 *
 * ## What is not here
 *
 * The four cells of `Waiting for you` — invoices, notices, complaints, night
 * status — and `Digital ID`, which is the shortcut row's lead cell. A cell up
 * there and a tile down here are two doors to one room inside a single scroll,
 * which is the rule that took `Statement` off the admin's grid. `more.tsx` has
 * no "Waiting for you" and no shortcut row, so More keeps every one of those
 * rows.
 *
 * Community too: it is a bottom tab, and unlike Residents on the admin side it
 * has no second identity as a section of the product. Food likewise — the tab is
 * one thumb-width away and the day's menu is already a card on this screen.
 */
export function ResidentServiceGrid({
  onOpen,
  onPrefetch,
}: {
  onOpen: (href: string) => void;
  /**
   * Called on touch-down with the href about to be pushed.
   *
   * The grid knows the hrefs and nothing else — which query each one implies is
   * `lib/resident-queries.ts`'s business, so a tile added here without an entry
   * there simply loads the way it always did.
   */
  onPrefetch?: (href: string) => void;
}) {
  const { colors, scheme } = useAppTheme();

  const services = [
    { href: "/profile", icon: "person-outline", label: "Profile", tone: "resident" },
    /*
      Directly beside Profile, because sharing your record with a parent is a
      decision people revisit — after a fee goes unpaid, after an argument — and
      it must not be something you can only reach two screens deep.
    */
    { href: "/guardians", icon: "shield-outline", label: "Guardians", tone: "brand" },
    {
      href: "/attendance",
      icon: "location-outline",
      label: "Location",
      tone: "warning",
    },
    {
      href: "/offer-program/mine",
      icon: "ribbon-outline",
      label: "Offer Program",
      tone: "success",
    },
    { href: "/hostels", icon: "search-outline", label: "Explore", tone: "brand" },
    { href: "/referrals", icon: "gift-outline", label: "Refer", tone: "success" },
    { href: "/review", icon: "star-outline", label: "Review", tone: "warning" },
  ] as const;

  const glyph = {
    brand: colors.primary,
    resident: roleAccent.RESIDENT[scheme],
    success: colors.success,
    warning: colors.warning,
  } as const;

  /*
    The chunking into rows of four, and the spacers that keep the last row's
    column pitch, are `<ActionTiles>`'s job — see the note there for why this may
    never become a `flex-wrap`.
  */
  const tiles: ActionTile[] = services.map((service) => ({
    glyph: glyph[service.tone],
    icon: service.icon,
    key: service.href,
    label: service.label,
    onPress: () => onOpen(service.href),
    onPressIn: onPrefetch ? () => onPrefetch(service.href) : undefined,
    tone: service.tone,
  }));

  return <ActionTiles tiles={tiles} />;
}
