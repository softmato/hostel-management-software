import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { IdScanner } from "@/components/manage/id-scanner";
import { ReferenceStrip } from "@/components/resident-payments";
import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip, FactRow } from "@/components/ui/layout";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Select } from "@/components/ui/select";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  createResident,
  getIntakeQuote,
  getManagedHostel,
  type IntakeQuote,
  lookupResidentProfile,
  type ManagedHostel,
  RESIDENT_TYPES,
  type ResidentIntakeResult,
  type ResidentPrefill,
  type ResidentType,
} from "@/lib/admin-manage-api";
import { readApiError } from "@/lib/api-contract";
import { formatDateIn } from "@/lib/calendar";
import { humanizeEnum } from "@/lib/format";
import { dayInputFromNow, startOfDayIso } from "@/lib/manage-dates";
import {
  backgroundFacts,
  careFacts,
  collectableBills,
  firstMonthNote,
  identityFacts,
  type IntakeFact,
  intakePeople,
  rentBasisNote,
  residentFullName,
} from "@/lib/resident-intake";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Admitting somebody — the one action on the roster that changes the building.
 *
 * ## It opens on a camera, because the resident already typed all of this
 *
 * Everybody who holds a HostelHub ID card filled in a profile to get it: name,
 * address, date of birth, guardians, what they study, what they play. Asking a
 * warden to retype twenty fields that already exist, from a person standing in
 * front of them, is the slowest and least accurate way to obtain data we have.
 * So step one is the card, and the form the warden fills is what is left after
 * the card has answered everything it can: a bed, a date, and a referral code.
 *
 * Typing the ID by hand, and registering somebody with no card at all, are both
 * still here. The second is a real case — a walk-in with a citizenship
 * certificate and no phone — and it is a *narrower* form rather than the old
 * one: the same three money questions, plus the name and number the card would
 * have supplied.
 *
 * ## Which scanner is this?
 *
 * The corridor has two, and they look at the same object. `manage/scan` **looks
 * a resident up**; this one **admits a new one**. Confusing them is silent and
 * expensive in this direction — an intake for somebody already living here
 * spends a bed and duplicates them — so `<IdScanner>` takes the brand tone here
 * against the lookup screen's neutral one, carries a "Step 1 of 3" pill the
 * lookup screen never has, and says *Register a new resident* where the other
 * says *Look up a resident*.
 *
 * ## The price is shown, never chosen
 *
 * The rent, the admission fee and the deposit are quoted by the server from the
 * rate card in force on the move-in date, and are rendered as `<FactRow>`s. This
 * screen used to prefill an editable *Monthly fee* box, which was wrong twice
 * over: `Resident.monthlyFee` is an override that outranks the rate card
 * forever, and the field defaulted to zero — so every resident registered from
 * this app was quietly billed nothing. A negotiated rate is still possible, on
 * the resident's own screen, where a reason is recorded beside it.
 *
 * ## The referral code has one chance
 *
 * If this person came through a resident's code it is entered here or never:
 * the link is made at creation and no route attaches one afterwards. It also
 * buys something now — the hostel's referral discount comes off the admission
 * fee — so the code is checked against the server as it is typed and the total
 * underneath it moves. It never touches the rent: a referral is a one-time
 * thank-you, not a standing rate for the referred resident.
 */

/**
 * `collect` is not a fourth thing to fill in — it is what the screen becomes
 * once the resident exists. See `CollectStep`.
 */
type Step = "collect" | "confirm" | "identify" | "terms";

const TYPE_OPTIONS = RESIDENT_TYPES.map((value) => ({
  label: humanizeEnum(value),
  value,
}));

/** What the card supplied, or what the warden typed when there was no card. */
type Identity =
  | { kind: "card"; prefill: ResidentPrefill; residentId: string }
  | { kind: "manual" };

export default function NewResidentScreen() {
  const hostel = useResource<ManagedHostel>(useCallback(() => getManagedHostel(), []));

  const [step, setStep] = useState<Step>("identify");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  /*
   * The gap between the buzz and the form.
   *
   * `lookupResidentProfile` is a network round trip, and until this the camera
   * kept its sweep running through it — the screen's own way of saying "still
   * looking". A warden who felt the success buzz and saw an unchanged
   * viewfinder held the card up a second time, which the scanner's `handled`
   * ref correctly ignores, so the screen looked broken for as long as the
   * request took.
   */
  const [reading, setReading] = useState(false);

  // Only reachable on the manual path — a card answers all four.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [residentType, setResidentType] = useState<ResidentType>("STUDENT");

  const [roomType, setRoomType] = useState<string | null>(null);
  const [moveInDate, setMoveInDate] = useState(() => dayInputFromNow(0));
  const [referralCode, setReferralCode] = useState("");
  const [saving, setSaving] = useState(false);

  /*
   * The intake response, kept rather than dropped on the floor. It carries the
   * reference codes for the invoices the server has just raised, and the desk
   * is the one moment somebody can act on them — see `CollectStep`.
   */
  const [registered, setRegistered] = useState<ResidentIntakeResult | null>(null);

  const rooms = useMemo(
    () => (hostel.data?.roomConfigurations ?? []).filter((config) => config.vacantBeds > 0),
    [hostel.data],
  );

  const quote = useIntakeQuote({ moveInDate, referralCode, roomType });

  const person = useMemo(() => {
    if (identity?.kind === "card") {
      return {
        email: identity.prefill.resident.email,
        firstName: identity.prefill.resident.firstName,
        lastName: identity.prefill.resident.lastName,
        phone: identity.prefill.resident.phone,
        residentType: normalizeResidentType(identity.prefill.resident.residentType),
      };
    }

    return {
      email: email.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      residentType,
    };
  }, [email, firstName, identity, lastName, phone, residentType]);

  const readCard = useCallback(async (residentId: string) => {
    setScanError(null);
    setReading(true);

    try {
      const { prefill } = await lookupResidentProfile(residentId);

      setIdentity({ kind: "card", prefill, residentId });
      setStep("confirm");
    } catch (error) {
      /*
       * Printed on the viewfinder rather than thrown as a toast. Every reason
       * this fails — a provider's card, an unfinished profile, sharing switched
       * off — is answered by *holding up a different card*, and a warden whose
       * camera is still live can do that without touching the screen.
       */
      setScanError(readApiError(error, "That card could not be read."));
    } finally {
      /*
       * In `finally`, not on the success path. A refused card leaves this screen
       * mounted and listening again, and a `reading` flag stuck true would dim
       * the keypad and hold the overlay over a camera that is very much live —
       * the one state from which there is no way forward at all.
       */
      setReading(false);
    }
  }, []);

  const submit = useCallback(async () => {
    if (person.firstName.length < 1 || person.lastName.length < 1) {
      toastError("Name them", "Both names, as they would write them.");
      return;
    }

    if (person.phone.length < 7) {
      toastError("Check the phone", "It is how the hostel reaches them.");
      return;
    }

    if (!roomType) {
      toastError("Pick a bed type", "Admitting somebody takes a bed off one of them.");
      return;
    }

    const iso = startOfDayIso(moveInDate);

    if (!iso) {
      toastError("Check the move-in date", "Write it as YYYY-MM-DD.");
      return;
    }

    setSaving(true);

    /*
     * The POST is the only thing whose failure means "not registered", so it is
     * the only thing inside this try.
     *
     * Everything below runs *after* the resident, their bed and their invoices
     * are committed on the server, and a single try around the lot turned any
     * slip down there — a contact that would not attach, a field this build
     * reads that the deployed API does not yet send — into "Could not register"
     * over a registration that had already succeeded. The warden then registered
     * them a second time and got the duplicate refusal, which is the only reason
     * anyone found out the first one had worked. The server holds this same rule
     * for itself (`raiseAdmissionInvoice`, `raiseFirstMonthInvoice`); the screen
     * has to hold it too.
     */
    let result: ResidentIntakeResult;

    try {
      result = await createResident({
        email: person.email || undefined,
        firstName: person.firstName,
        lastName: person.lastName,
        moveInDate: iso,
        phone: person.phone,
        referralCode: referralCode.trim() || undefined,
        residentType: person.residentType,
        roomType,
        /*
         * Always active. The intake screen used to carry a "Living here" toggle
         * that wrote `PENDING` instead, and nobody ever turned it off — a warden
         * is registering the person standing at the desk. A pending resident
         * holds a bed without being counted in occupancy or billed for it, which
         * is a state worth having but not one worth asking about here; the
         * resident's own screen is where somebody who has not turned up yet gets
         * marked so.
         */
        status: "ACTIVE",
        // The card that opened this intake, so the server links the account it
        // already resolved rather than guessing at it from the email.
        userResidentId: identity?.kind === "card" ? identity.residentId : undefined,
      });
    } catch (error) {
      toastError("Could not register", readApiError(error, "That did not save."));
      setSaving(false);
      return;
    }

    /*
     * Their own guardian and emergency records, written from the card they
     * presented. This is the whole point of scanning: the contacts a hostel
     * would otherwise retype — and would retype wrongly — arrive with them.
     * Settled rather than awaited in series, and a failure here is counted
     * rather than raised: the resident is registered, and a missing second
     * guardian is fixed from their own screen.
     */
    let contacts = 0;

    try {
      contacts =
        identity?.kind === "card"
          ? await attachContacts(result.resident.id, identity.prefill)
          : 0;
    } catch {
      contacts = 0;
    }

    setSaving(false);
    toastSuccess("Registered", registeredNote(result, contacts));

    /*
     * Not `router.replace` any more. Navigating straight to the dossier threw
     * away the two reference codes in `result` at the exact moment they were
     * worth something — the resident is still at the desk with their phone out,
     * and asking them to go home and find the code in their own app is asking
     * for a payment that arrives next week or not at all.
     *
     * The dossier is one tap on, from the footer.
     */
    setRegistered(result);
    setStep("collect");
  }, [identity, moveInDate, person, referralCode, roomType]);

  if (step === "identify") {
    return (
      <IdScanner
        busy={reading ? "Fetching their details" : null}
        extraAction={
          <Pressable
            accessibilityLabel="Register somebody with no ID card"
            accessibilityRole="button"
            className="flex-row items-center justify-center gap-2 rounded-2xl px-5 py-3 active:opacity-70"
            onPress={() => {
              setIdentity({ kind: "manual" });
              setStep("confirm");
            }}
          >
            <Ionicons color="rgba(255,255,255,0.8)" name="create-outline" size={16} />
            <Text className="text-sm font-semibold text-white/80">
              They have no card — fill it in by hand
            </Text>
          </Pressable>
        }
        hint={scanError}
        manualTitle="Their resident ID"
        onClose={() => router.back()}
        onResidentId={(residentId) => void readCard(residentId)}
        step="Step 1 of 3"
        subtitle="Scan the QR on their HostelHub card and their details fill themselves in."
        title="Register a new resident"
        tone="brand"
      />
    );
  }

  /*
   * Registered, and still on screen.
   *
   * Ahead of the loading and error guards below deliberately: those describe
   * whether the *form* can be drawn, and the form is finished. A hostel resource
   * that happened to be refetching would otherwise replace a screen holding two
   * live reference codes with a spinner, and there is no way back to it.
   */
  if (step === "collect" && registered) {
    return (
      <Screen
        footer={
          <Button
            label="Open their profile"
            onPress={() => router.replace(`/manage/resident/${registered.resident.id}`)}
          />
        }
        header={
          <AppBar
            accent
            centerTitle
            subtitle={`${person.firstName} ${person.lastName}`.trim() || undefined}
            title="Registered"
          />
        }
        scroll
      >
        <CollectStep result={registered} />
      </Screen>
    );
  }

  if (hostel.loading) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="New resident" />}>
        <LoadingState label="Checking which beds are free" />
      </Screen>
    );
  }

  if (hostel.error || !hostel.data) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="New resident" />}>
        <ErrorState message={hostel.error ?? "No hostel"} onRetry={hostel.reload} />
      </Screen>
    );
  }

  const back = () => setStep(step === "terms" ? "confirm" : "identify");

  return (
    <Screen
      footer={
        step === "confirm" ? (
          <Button label="Next — bed and money" onPress={() => setStep("terms")} />
        ) : (
          <Button label="Register them" loading={saving} onPress={() => void submit()} />
        )
      }
      header={
        <AppBar
          accent
          centerTitle
          onBack={back}
          showBack
          subtitle={step === "confirm" ? "Step 2 of 3" : "Step 3 of 3"}
          title={step === "confirm" ? "Confirm who they are" : "Bed, date and money"}
        />
      }
      scroll
    >
      {step === "confirm" ? (
        <ConfirmStep
          email={email}
          firstName={firstName}
          identity={identity}
          lastName={lastName}
          onChangeEmail={setEmail}
          onChangeFirstName={setFirstName}
          onChangeLastName={setLastName}
          onChangePhone={setPhone}
          onChangeResidentType={setResidentType}
          onRescan={() => {
            setIdentity(null);
            setScanError(null);
            setStep("identify");
          }}
          phone={phone}
          residentType={residentType}
        />
      ) : (
        <TermsStep
          moveInDate={moveInDate}
          onChangeMoveInDate={setMoveInDate}
          onChangeReferralCode={setReferralCode}
          onPickRoom={setRoomType}
          quote={quote}
          referralCode={referralCode}
          roomType={roomType}
          rooms={rooms}
        />
      )}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 2 — what the card said                                                */
/* -------------------------------------------------------------------------- */

/**
 * Their own answers, read back.
 *
 * Label left, value right, in `<FactRow>` — the same shape the resident dossier
 * and every money screen use, so a warden reading this has read it before. It is
 * deliberately **not editable**: this is the resident's own profile, they
 * maintain it, and a hostel silently correcting somebody's date of birth into
 * their own copy is how two systems come to disagree about one person. Something
 * genuinely wrong is a different card or the manual path, both one tap away.
 */
function ConfirmStep({
  email,
  firstName,
  identity,
  lastName,
  onChangeEmail,
  onChangeFirstName,
  onChangeLastName,
  onChangePhone,
  onChangeResidentType,
  onRescan,
  phone,
  residentType,
}: {
  email: string;
  firstName: string;
  identity: Identity | null;
  lastName: string;
  onChangeEmail: (value: string) => void;
  onChangeFirstName: (value: string) => void;
  onChangeLastName: (value: string) => void;
  onChangePhone: (value: string) => void;
  onChangeResidentType: (value: ResidentType) => void;
  onRescan: () => void;
  phone: string;
  residentType: ResidentType;
}) {
  const { colors } = useAppTheme();
  const dates = useDates();

  if (identity?.kind !== "card") {
    return (
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader
            subtitle="No card was scanned, so these are the only details the hostel will hold"
            title="Who they are"
          />
          <Card className="gap-3">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Input
                  autoCapitalize="words"
                  label="First name"
                  onChangeText={onChangeFirstName}
                  value={firstName}
                />
              </View>
              <View className="flex-1">
                <Input
                  autoCapitalize="words"
                  label="Last name"
                  onChangeText={onChangeLastName}
                  value={lastName}
                />
              </View>
            </View>

            <Input
              hint="One phone number per resident — a number already on the roll is refused."
              keyboardType="phone-pad"
              label="Phone"
              onChangeText={onChangePhone}
              value={phone}
            />

            <Input
              autoCapitalize="none"
              hint="Their activation code and receipts go here. Optional, but without it every code has to be read out loud."
              keyboardType="email-address"
              label="Email"
              onChangeText={onChangeEmail}
              value={email}
            />

            <Select
              label="They are a"
              onChange={onChangeResidentType}
              options={TYPE_OPTIONS}
              value={residentType}
            />
          </Card>
        </View>

        <Pressable
          accessibilityRole="button"
          className="flex-row items-center justify-center gap-2 py-2 active:opacity-60"
          onPress={onRescan}
        >
          <Ionicons color={colors.primary} name="qr-code-outline" size={16} />
          <Text className="text-sm font-semibold text-primary">
            They do have a card — scan it instead
          </Text>
        </Pressable>
      </View>
    );
  }

  const { prefill, residentId } = identity;
  const people = intakePeople(prefill);
  const background = backgroundFacts(prefill);
  const notes = prefill.details.medicalNotes?.trim();

  return (
    <View className="gap-5 pt-1">
      {/*
        A painted block with rounded bottom corners, which `NOTES.md` records as
        how the reference apps mark the thing a screen is *about*. What is
        straddling its bottom edge is the resident's own ID — the fact that makes
        every row under it theirs rather than something we typed.
      */}
      <View className="-mt-1">
        <View className="items-center gap-1 rounded-b-3xl bg-primary px-5 pb-7 pt-4">
          <Text className="text-xs font-bold uppercase tracking-wide text-primary-foreground/75">
            Shared from their ID card
          </Text>
          <Text className="text-center text-xl font-bold text-primary-foreground">
            {residentFullName(prefill)}
          </Text>
        </View>
        <View className="-mt-4 items-center">
          <View className="rounded-full border border-border bg-card px-4 py-1.5">
            <Text className="text-xs font-semibold tracking-wide text-foreground">
              {residentId}
            </Text>
          </View>
        </View>
      </View>

      <FactCard facts={identityFacts(prefill, dates.calendar)} title="Who they are" />

      {background.length > 0 ? (
        <FactCard facts={background} title="Where they are from, and what they do" />
      ) : null}

      <FactCard facts={careFacts(prefill)} title="What the hostel must know" />

      {notes ? (
        <View className="rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <Text className="text-xs font-bold uppercase tracking-wide text-warning">
            Medical notes
          </Text>
          <Text className="mt-1 text-sm text-foreground">{notes}</Text>
        </View>
      ) : null}

      {people.length > 0 ? (
        <View>
          <SectionHeader
            subtitle="Saved as their guardian and emergency records when you register them"
            title="Who to call"
          />
          <Card padding="px-4 py-1">
            {people.map((person) => (
              <FactRow
                key={`${person.label}-${person.phone}`}
                label={person.label}
                value={
                  <View className="items-end">
                    <Text className="text-right text-sm font-medium text-foreground">
                      {person.name}
                    </Text>
                    <Text className="text-right text-xs text-muted-foreground">
                      {person.phone}
                    </Text>
                  </View>
                }
              />
            ))}
          </Card>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        className="flex-row items-center justify-center gap-2 py-2 active:opacity-60"
        onPress={onRescan}
      >
        <Ionicons color={colors.primary} name="qr-code-outline" size={16} />
        <Text className="text-sm font-semibold text-primary">
          Not them — scan another card
        </Text>
      </Pressable>
    </View>
  );
}

function FactCard({ facts, title }: { facts: IntakeFact[]; title: string }) {
  if (facts.length === 0) {
    return null;
  }

  return (
    <View>
      <SectionHeader title={title} />
      {/* Narrower vertical inset: the rows carry their own `py-2.5`. */}
      <Card padding="px-4 py-1">
        {facts.map((fact) => (
          <FactRow key={fact.label} label={fact.label} value={fact.value} />
        ))}
      </Card>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Step 3 — bed, date, money                                                  */
/* -------------------------------------------------------------------------- */

function TermsStep({
  moveInDate,
  onChangeMoveInDate,
  onChangeReferralCode,
  onPickRoom,
  quote,
  referralCode,
  roomType,
  rooms,
}: {
  moveInDate: string;
  onChangeMoveInDate: (value: string) => void;
  onChangeReferralCode: (value: string) => void;
  onPickRoom: (value: string) => void;
  quote: { data: IntakeQuote | null; loading: boolean };
  referralCode: string;
  roomType: string | null;
  rooms: ManagedHostel["roomConfigurations"];
}) {
  /*
   * The move-in date said back in Nepali, under the field.
   *
   * Not `useDates().dateBoth`, which every other `manage/` screen reaches for:
   * that prints the calendar the owner chose with the other in a parenthesis,
   * and the box directly above already holds the Gregorian day they just typed.
   * The hint's job here is the half they cannot read off the field — so it is
   * always Bikram Sambat, and it moves on every keystroke.
   */
  const moveInHint = nepaliDayLabel(moveInDate);

  return (
    <View className="gap-5 pt-1">
      <View>
        <SectionHeader
          subtitle="Only bed types with a free bed are shown"
          title="Where they sleep"
        />
        <Card className="gap-3">
          {rooms.length === 0 ? (
            <Text variant="muted">
              Every bed type is full. Free a bed by moving somebody out, or add
              capacity on the Rooms screen.
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {rooms.map((config) => (
                <Chip
                  icon="bed-outline"
                  key={config.roomType}
                  label={`${config.roomType} · ${config.vacantBeds} free`}
                  onPress={() => onPickRoom(config.roomType)}
                  tone={roomType === config.roomType ? "brand" : "neutral"}
                />
              ))}
            </View>
          )}

          <Input
            hint={moveInHint}
            keyboardType="numbers-and-punctuation"
            label="Moving in on"
            onChangeText={onChangeMoveInDate}
            placeholder="YYYY-MM-DD"
            value={moveInDate}
          />
        </Card>
      </View>

      <View>
        <SectionHeader
          subtitle="Set by the hostel's rate card — not editable here"
          title="What it costs"
        />
        <MoneyCard quote={quote} roomType={roomType} />
      </View>

      <View>
        <SectionHeader
          subtitle="Only enterable now — there is no route that attaches one later"
          title="Referred by"
        />
        <Card>
          <Input
            autoCapitalize="characters"
            autoCorrect={false}
            hint={
              quote.data?.referral.reason ??
              "The code the referring resident shared. It earns them their reward, and takes the hostel's referral discount off the admission fee."
            }
            label="Referral code"
            onChangeText={onChangeReferralCode}
            placeholder="Optional"
            value={referralCode}
          />
        </Card>
      </View>
    </View>
  );
}

/**
 * The typed day, said back in Bikram Sambat.
 *
 * Always BS, never the hostel's chosen calendar: the box above it is a
 * `YYYY-MM-DD` Gregorian field, so this line is the *translation* of what was
 * typed rather than a second rendering of it, and following the preference here
 * would print the same date twice for a hostel that keeps books in English.
 *
 * Routed through `startOfDayIso` rather than parsed here so the Nepali day shown
 * is the one the server will actually be sent — the conversion happens on the
 * instant, at Nepal's offset, exactly as it does on save. A half-typed date has
 * no Nepali day, and says the format instead.
 */
function nepaliDayLabel(dayInput: string): string {
  const iso = startOfDayIso(dayInput);

  return iso ? formatDateIn("BS", iso) : "Write the day as YYYY-MM-DD";
}

/**
 * The bill, as facts.
 *
 * Rent, admission fee, discount, then what is actually collected today — in the
 * order somebody at a desk says them out loud. The discount line is only drawn
 * when there is one, because a permanent "− NPR 0" row reads as an offer that
 * failed rather than an offer that does not exist.
 */
function MoneyCard({
  quote,
  roomType,
}: {
  quote: { data: IntakeQuote | null; loading: boolean };
  roomType: string | null;
}) {
  if (!roomType) {
    return (
      <Card>
        <Text variant="muted">Pick a bed type above to see what this stay costs.</Text>
      </Card>
    );
  }

  if (!quote.data) {
    return (
      <Card>
        <Text variant="muted">
          {quote.loading ? "Reading the rate card…" : "The rate card could not be read."}
        </Text>
      </Card>
    );
  }

  const {
    admissionFee,
    admissionPayable,
    depositAmount,
    firstMonth,
    monthlyRent,
    referral,
    rentBasis,
  } = quote.data;

  return (
    <View className="gap-2">
      <Card padding="px-4 py-1">
        <FactRow
          label="Monthly rent"
          value={
            monthlyRent === null ? (
              <Text className="text-right text-sm font-medium text-warning">
                Not priced yet
              </Text>
            ) : (
              <Money value={monthlyRent} />
            )
          }
        />
        {/*
          The month they are actually walking into, directly under the month
          rate it is derived from.

          This is the row the screen was missing. A hostel admitting somebody on
          the 20th was shown "Monthly rent NPR 6,000" and nothing else, so the
          only figure on the screen was one the resident does not owe this month
          — and the server, until now, billed them nothing for it at all. See
          `raiseFirstMonthInvoice`.
        */}
        {firstMonth ? (
          <FactRow
            label={firstMonth.prorated ? "This month (part)" : "This month"}
            value={<Money value={firstMonth.amount} />}
          />
        ) : null}
        {depositAmount > 0 ? (
          <FactRow label="Deposit held" value={<Money value={depositAmount} />} />
        ) : null}
        <FactRow
          label="Admission fee"
          value={
            admissionFee > 0 ? (
              <Money value={admissionFee} />
            ) : (
              <Text className="text-right text-sm font-medium text-muted-foreground">
                None
              </Text>
            )
          }
        />
        {referral.applied ? (
          <FactRow
            label={`Referral discount · ${referral.code}`}
            value={
              <Text className="text-right text-sm font-semibold text-success">
                {`− ${formatDiscount(referral.discount)}`}
              </Text>
            }
          />
        ) : null}
        {admissionFee > 0 ? (
          <View className="border-t border-border">
            <FactRow
              label="Due at move-in"
              value={<Money size="large" value={admissionPayable} />}
            />
          </View>
        ) : null}
      </Card>

      <Text className="px-1 text-xs text-muted-foreground">
        {firstMonth ? `${firstMonthNote(firstMonth)} ${rentBasisNote(rentBasis)}` : rentBasisNote(rentBasis)}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* After registering — what can be collected at the desk                      */
/* -------------------------------------------------------------------------- */

/**
 * The bill, again, with the codes that settle it — while they are still here.
 *
 * ## Why this screen exists at all
 *
 * The intake used to end on a toast and a jump to the dossier. The response it
 * jumped away from carried a reference code for each invoice the server had
 * just raised, and those codes are the only way a payment can be matched to
 * this resident. A person who has just handed over a phone number, a card and a
 * signature is at their most willing to also hand over the money; sending them
 * home to find the code themselves converts that into an open invoice.
 *
 * So the last thing the warden sees is what to collect and what to quote.
 *
 * ## One row per invoice, and no total across them
 *
 * `collectableBills` returns the joining charge and the first month separately
 * because they *are* separate invoices with separate codes. Summing them under
 * one figure would invite one transfer for the total quoting one of the two
 * codes — which settles that invoice, overpays it into credit, and leaves the
 * other showing unpaid. The line under the rows says so in words rather than
 * relying on two cards to imply it.
 *
 * ## Nothing to collect is an outcome, not an error
 *
 * A hostel with no admission fee, no deposit and no rate card raises no invoice
 * at the desk, and a resident marked as not yet living here is not billable
 * yet. Both are ordinary, and both get a sentence — an empty card under
 * "Collect now" would read as a screen that failed to load.
 */
function CollectStep({ result }: { result: ResidentIntakeResult }) {
  const dates = useDates();

  const bills = collectableBills(result, dates.periodMonth);

  if (bills.length === 0) {
    return (
      <View className="gap-5 pt-1">
        <SectionHeader
          subtitle="They are registered and hold a bed"
          title="Nothing to collect yet"
        />
        <Card>
          <Text variant="muted">
            No invoice was raised at registration, so there is no code to quote. Their
            first bill and its code appear on their own screen when it is raised.
          </Text>
        </Card>
      </View>
    );
  }

  return (
    <View className="gap-5 pt-1">
      <View className="gap-2">
        <SectionHeader
          subtitle="If they want to pay now, this is what to quote"
          title="Collect now"
        />

        {bills.map((bill) => (
          <Card key={bill.referenceCode} padding="px-4 pb-3 pt-1">
            <FactRow label={bill.label} value={<Money size="large" value={bill.amount} />} />
            {/*
              The code sits under the figure it settles rather than beside it.
              Two cards, two codes, and the only thing that keeps them straight
              is that each code is directly beneath its own amount — a column of
              codes on the right margin would be two strings a warden could read
              across the wrong row.
            */}
            <ReferenceStrip code={bill.referenceCode} hint="Reference code" />
          </Card>
        ))}
      </View>

      {bills.length > 1 ? (
        <Text className="px-1 text-xs text-muted-foreground">
          Two invoices, so two payments — each one quotes its own code. A single
          transfer for the total settles only the invoice whose code it carries.
        </Text>
      ) : (
        <Text className="px-1 text-xs text-muted-foreground">
          One payment, one code. It works for cash at the desk as well as a transfer —
          the code is how the payment is matched to them either way.
        </Text>
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The quote, refetched as the three things that move it change.
 *
 * What is on screen is **derived** from whether the answer we hold was fetched
 * for the inputs currently showing — the key below — rather than cleared by an
 * effect. That is what stops the stale frame nobody would think to look for: a
 * warden switching from Single to Four Sharing would otherwise read the single
 * room's rent for as long as the next request took, and it looks entirely
 * correct while it is wrong.
 *
 * Debounced for the referral field rather than the chips: a code is eight or so
 * characters and an un-debounced effect would fire a request per keystroke at an
 * endpoint that reads a rate card each time. 400ms covers typing and still moves
 * the total before a thumb reaches the button under it.
 */
function useIntakeQuote({
  moveInDate,
  referralCode,
  roomType,
}: {
  moveInDate: string;
  referralCode: string;
  roomType: string | null;
}) {
  /* `quote: null` is a settled failure, not an absent answer — the difference
     between "the rate card could not be read" and "still reading". */
  const [answer, setAnswer] = useState<{
    key: string;
    quote: IntakeQuote | null;
  } | null>(null);

  const key = roomType
    ? [roomType, moveInDate, referralCode.trim().toUpperCase()].join("|")
    : null;

  useEffect(() => {
    if (!key || !roomType) {
      return;
    }

    let live = true;
    const timer = setTimeout(() => {
      void getIntakeQuote({
        moveInDate: startOfDayIso(moveInDate) ?? undefined,
        referralCode: referralCode.trim() || undefined,
        roomType,
      })
        .then((quote) => {
          if (live) {
            setAnswer({ key, quote });
          }
        })
        .catch(() => {
          // Nothing to show, and the card says so. A toast here would fire while
          // somebody is still mid-way through typing a code.
          if (live) {
            setAnswer({ key, quote: null });
          }
        });
    }, 400);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, moveInDate, referralCode, roomType]);

  const settled = answer?.key === key;

  return {
    data: settled ? answer.quote : null,
    loading: Boolean(key) && !settled,
  };
}

/** `NPR 1,500` without the component, for the one place it sits inside a string. */
function formatDiscount(amount: number) {
  return `NPR ${amount.toLocaleString("en-NP")}`;
}

/**
 * The profile's `occupation` is free-ish text; `residentType` is an enum.
 *
 * Anything that is not one of the three lands on `OTHER` rather than being
 * passed through, because the server rejects an unknown value and losing a whole
 * intake to somebody having written "Freelancer" would be absurd.
 */
function normalizeResidentType(value: string): ResidentType {
  const upper = value.trim().toUpperCase().replace(/\s+/g, "_");

  return (RESIDENT_TYPES as readonly string[]).includes(upper)
    ? (upper as ResidentType)
    : "OTHER";
}

/** Their guardians and emergency contact, written from the card they showed. */
async function attachContacts(residentId: string, prefill: ResidentPrefill) {
  const { addEmergencyContact, addResidentGuardian } = await import(
    "@/lib/admin-manage-api"
  );

  const outcomes = await Promise.allSettled([
    ...prefill.guardians.map((guardian) =>
      addResidentGuardian(residentId, {
        email: guardian.email,
        firstName: guardian.firstName,
        isPrimary: guardian.isPrimary,
        lastName: guardian.lastName,
        phone: guardian.phone,
        relation: guardian.relation,
      }),
    ),
    addEmergencyContact(residentId, {
      isPrimary: prefill.emergencyContact.isPrimary,
      name: prefill.emergencyContact.name,
      phone: prefill.emergencyContact.phone,
      relation: prefill.emergencyContact.relation,
    }),
  ]);

  return outcomes.filter((outcome) => outcome.status === "fulfilled").length;
}

/**
 * What the success toast says, in the order it matters.
 *
 * Rent leads when it was billed, because that is the new obligation somebody
 * has to be told about — and because a first month that quietly failed to bill
 * is exactly the silence this whole change exists to end. The reason is not
 * printed: `NOT_YET_RESIDENT` is a server enum, and the honest phrasing of it
 * for a warden who deliberately ticked "not yet arrived" is that nothing is due
 * yet, which is what the sentence says.
 *
 * The login comes last and is always said, because it is the one outcome the
 * warden can still act on while the resident is standing in front of them.
 *
 * Every sentence is dropped rather than guessed when the fact behind it is
 * missing, and nothing in here may throw: it is describing work the server has
 * already finished.
 */
function registeredNote(result: ResidentIntakeResult, contacts: number) {
  /*
   * Read defensively, every field of it. This runs against whatever version of
   * the API the phone happens to be pointed at — `EXPO_PUBLIC_API_URL` sends
   * even a debug build to the deployed origin — so a field this build knows
   * about can simply be absent from the response, and a sentence nobody reads
   * twice must not be able to take a completed intake down with it.
   */
  const sentences = [
    contacts > 0 ? `${contacts} contact records saved.` : null,
    // An absent `firstMonth` says nothing at all, rather than guessing: a server
    // that does not send the field is one that did not raise the invoice, and
    // "this month's rent is invoiced" would be a claim about money that is false.
    result.firstMonth
      ? result.firstMonth.raised
        ? "This month's rent is invoiced."
        : "No rent is due yet — it is billed when they are marked as living here."
      : null,
    result.admission?.raised ? "Their admission fee is invoiced too." : null,
    /*
     * Said out loud because the alternative is silence. When the link does not
     * hold the resident has no login at all — their website account stays
     * public and the resident portal never appears for them — until somebody
     * issues an activation code, and this toast is the only moment anyone is in
     * a position to notice.
     */
    result.accountLink?.linked
      ? "They can sign in with their own email."
      : "No login was linked — issue their activation code.",
  ];

  return sentences.filter(Boolean).join(" ");
}
