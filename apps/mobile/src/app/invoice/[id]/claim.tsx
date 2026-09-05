import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { ReceiptPreview } from "@/components/receipt-preview";
import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { Select, type SelectOption } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { FailureState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { WalletMark } from "@/components/ui/wallet-mark";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { readApiError, readApiErrorCode, readApiErrorDetails } from "@/lib/api-contract";
import { openAssetViewer } from "@/lib/asset-viewer";
import { notifyClaimOutcome } from "@/lib/claim-notifier";
import { prepareEvidenceForUpload } from "@/lib/evidence-image";
import {
  AUTO_METHOD,
  CLAIM_METHODS,
  type ClaimErrors,
  type ClaimRejection,
  type ClaimRejectionDetails,
  claimRejection,
  hasErrors,
  parseClaimAmount,
  resolveClaimMethod,
  transactionCodeRequired,
  uploadRejection,
  validateClaim,
  whereToLook,
} from "@/lib/claim-form";
import {
  type EvidenceStage,
  STAGE_LABELS,
  useEvidenceReader,
} from "@/lib/evidence-reader";
import {
  getPayInstructions,
  type PayInstructions,
  type PaymentMethod,
  submitClaim,
} from "@/lib/finance-api";
import { formatMoney } from "@/lib/format";
import { toastError, toastInfo, toastSuccess } from "@/lib/toast";
import { uploadAsset, type UploadProgress } from "@/lib/uploads";

/**
 * "Submit payment proof" — a claim against one invoice (target §11.2, §11.3).
 *
 * ## The receipt fills the form in
 *
 * This screen used to accept any image at all, say nothing about it, and leave
 * the resident to copy a ten-digit transaction id across from a screenshot they
 * were holding — the single most error-prone thing on it, and a mistyped id is
 * one of the instant rejections. The web form has read the file in front of the
 * resident since it was written; the phone did not, so the phone was where a
 * wrong file was discovered last and cost the most.
 *
 * It now uploads first and reads: `lib/evidence-reader.ts` streams the server's
 * stages while they happen, and the amount, the method and the transaction id
 * arrive off the receipt. **The promise is made before the picker**, not after —
 * a resident who does not know the file fills the form in types those fields
 * first, and the read deliberately does not overwrite typing, so the feature
 * they were never told about is the one that never runs.
 *
 * ## What blocks, what merely warns, and why the difference is the whole design
 *
 * The read comes back with verdicts of three strengths, and collapsing them
 * would break the screen in one direction or the other:
 *
 * - **Blocking** — the file is one *we* issued, or a page of text with no
 *   payment on it at all, or a receipt showing money arriving rather than
 *   leaving / a failed transaction / a payment to somebody who is not this
 *   hostel. The submit path refuses every one of these outright, so leaving the
 *   button live would let a resident fill in a whole form to be told no.
 * - **Warning** — "this does not look like a receipt", "that is a statement, not
 *   a receipt". These fire on weak evidence and must never block: a genuine
 *   receipt whose OCR came out badly still has to reach a human, and refusing
 *   real proof is by far the worse failure.
 * - **Silent** — nothing could be read. The resident types two fields, as
 *   before. Autofill is a convenience laid over a form that already worked, and
 *   telling them about OCR would be telling them about our problem.
 *
 * **None of it is decided on the phone.** Every verdict is computed by the same
 * server functions `submitClaim` calls, so the form and the refusal cannot tell
 * a resident two different things ten seconds apart — and a modified client that
 * ignored them would still be refused at submit, because a client is not a gate.
 *
 * ## Why the submit button is not a retry loop
 *
 * `POST .../claims` is rate-limited to **8 an hour**: each call runs sharp and
 * tesseract over a full-size image, seconds of CPU per submit. A client that
 * retried on failure would spend a resident's whole budget in one frustrated
 * minute. Every check the server does that the phone can do first is done in
 * `lib/claim-form.ts` before a request is made — including, now, the two
 * transaction-id rules, because `TXN_ID_REQUIRED` and `TXN_ID_NOT_PLAUSIBLE`
 * were costing a submit each to say something the phone already knew.
 *
 * ## A repeat submit is not a second claim
 *
 * The server is idempotent: a replayed submit collapses onto the existing claim
 * and answers `created: false` with a 200. That is reported as "already
 * submitted", not as a fresh success — telling someone their proof went through
 * twice is how they start wondering whether they paid twice.
 *
 * ## An instant rejection replaces the form
 *
 * The duplicate screenshot, the reused transaction id and the three unreadable
 * cases never reach the owner's queue, so this screen is the only place the
 * resident learns anything. It says what collided and when, drops the file that
 * has to change, and leaves them one upload from a valid claim rather than back
 * at the start of the form.
 */

/**
 * The `<Select>`'s options: Auto leads, then the six the server accepts.
 *
 * Typed as `SelectOption<string>` rather than left to infer a union of the seven
 * literals. The screen holds the selection as a plain string — it is one of
 * these, or the resolved method, or nothing yet — and a narrower generic here
 * would push a cast onto every one of those.
 */
const METHOD_CHOICES: SelectOption<string>[] = [
  {
    description: "We read it off the receipt you upload",
    label: "Auto",
    value: AUTO_METHOD,
  },
  ...CLAIM_METHODS,
];

export default function SubmitClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useAppTheme();
  const dates = useDates();

  const instructions = useResource<PayInstructions>(
    useCallback(() => getPayInstructions(id), [id]),
    // The amount is prefilled from this, and re-reading it while the resident is
    // mid-form would move the number under their fingers.
    { refetchOnFocus: false },
  );

  /**
   * Only what the resident has actually typed.
   *
   * **Derived, not synchronised.** The obvious build — an effect copying the
   * recognised fields into state — is a cascading render *and* a race: the read
   * lands after first paint, so any field they had already touched would be
   * overwritten by a value they had just corrected. Here their edit is the
   * override and the receipt is only the fallback, so "never clobber typing" is
   * a property of the shape rather than a check that has to keep holding.
   */
  const [edits, setEdits] = useState<{
    amount?: string;
    method?: string;
    transactionCode?: string;
  }>({});
  const [note, setNote] = useState("");
  const [proofAssetId, setProofAssetId] = useState<string | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofMimeType, setProofMimeType] = useState<string | undefined>(undefined);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<ClaimErrors>({});
  const [rejection, setRejection] = useState<ClaimRejection | null>(null);
  /**
   * Why the last file never became an attachment.
   *
   * Kept on the screen rather than left to the upload toaster, and it is the
   * difference between a resident who knows to take a different screenshot and
   * one staring at an empty dropzone. A refused *upload* clears the preview, so
   * without this the whole event is a toast that scrolls away and a form that
   * looks exactly as it did before they picked anything.
   *
   * Not the full-screen {@link rejection}: that one ends the attempt and offers
   * `Try again` / `Cancel`, which is right for a refused submit and far too
   * heavy for "that photo will not open, pick another". This sits above the
   * picker with the picker still there.
   */
  const [attachRejection, setAttachRejection] = useState<ClaimRejection | null>(null);
  const [whereOpen, setWhereOpen] = useState(false);
  /**
   * Whether this build can open the system file browser at all.
   *
   * Once per mount — whether a native module is linked cannot change while the
   * app is running — and read here as well as in the dropzone, because the
   * attached-file row offers the same way back in.
   */
  const [canPickDocument] = useState(() => loadDocumentPicker() !== null);

  const evidence = useEvidenceReader();
  const { read: readEvidence, reset: resetEvidence } = evidence;
  const found = evidence.fields;
  const data = instructions.data;

  useEffect(() => {
    if (proofAssetId) {
      // The invoice goes with the read so the server can check *this month's*
      // reference code against the receipt, rather than the screen guessing from
      // whatever code the extractor happened to find on the image.
      void readEvidence(proofAssetId, id);
    } else {
      resetEvidence();
    }
  }, [id, proofAssetId, readEvidence, resetEvidence]);

  const amount =
    edits.amount ??
    (found?.amount !== undefined ? String(found.amount) : String(data?.amountDue ?? ""));
  const transactionCode = edits.transactionCode ?? found?.transactionCode ?? "";
  /**
   * What the resident chose, which may be `AUTO` — the default.
   *
   * Kept apart from {@link method}: the trigger has to keep saying `Auto` after a
   * receipt resolves to eSewa, or the setting changes under the resident and
   * their *next* upload is locked to the app the *last* one happened to be.
   */
  const selection = edits.method ?? AUTO_METHOD;
  /** What the receipt itself says the app was. Null until one is read. */
  const detected = found?.method ?? null;
  const method = resolveClaimMethod(selection, detected);
  const isCash = method === "CASH";
  /** Which fields the resident is looking at values they did not type. */
  const filled = {
    amount: edits.amount === undefined && found?.amount !== undefined,
    method: selection === AUTO_METHOD && Boolean(detected),
    transactionCode:
      edits.transactionCode === undefined && Boolean(found?.transactionCode),
  };

  /**
   * The read results that stop the form rather than informing it.
   *
   * Everything else the reader returns is a hint the resident may override — a
   * corrected amount, a retyped id, a receipt we thought looked odd. These are
   * not hints: the submit path refuses all of them. The wording is the server's
   * so the resident does not read two explanations of one refusal.
   */
  const blockReason = evidence.systemDocument
    ? "That is a receipt your hostel issued, not a record of your payment. Please upload the screenshot or receipt from the app you paid with — the one showing the money leaving your account."
    : evidence.notPayment
      ? "That file does not look like a payment at all — there is no app name, no amount and no transaction ID on it. Please upload the screenshot or receipt from the app you paid with."
      : // The three the server computed rather than this screen: money arriving
        // instead of leaving, a failed transaction, a payment to somebody who is
        // not this hostel. Taken as prose because each names something specific
        // about *their* file that a fixed string here could not say.
        (evidence.refusal ?? "");

  /*
   * One refusal, reported in two places.
   *
   * The banner is the durable copy — it stays on screen while the resident finds
   * a different file, which for the longer sentences is the whole point. The
   * toast is the one that *arrives*: it renders over the screen wherever they
   * have scrolled to, and the resident's eye is on the preview at the bottom of
   * the form when the read comes back, not on the notice at the top.
   *
   * Fires on the transition into the blocked state, which is once per read.
   */
  useEffect(() => {
    if (blockReason) {
      toastError("That file cannot be used as proof", blockReason);
      /*
       * …and a third place, which is the only one that survives the resident
       * leaving.
       *
       * The read is the slow leg of this screen, and the obvious thing to do
       * while it runs is switch to the wallet app to copy the transaction ID.
       * Come back and the toast has gone; lock the phone and the whole answer
       * was delivered to nobody. The shade is where a verdict that arrived
       * while they were elsewhere can still be found.
       */
      notifyClaimOutcome(
        { body: blockReason, title: "That file cannot be used as proof", tone: "failure" },
        id,
      );
    }
  }, [blockReason, id]);

  /*
   * The six methods with their marks.
   *
   * `CLAIM_METHODS` is a plain label/value table in `lib/claim-form.ts`, which
   * has to stay node-testable and therefore cannot import a component. The marks
   * are attached here — and it matters on this list more than anywhere else in
   * the app, because getting the method wrong sends the hostel looking for the
   * payment in the wrong statement, and six wallet names in identical grey type
   * is exactly the list that gets mis-tapped.
   *
   * `Auto` takes the scan glyph rather than a wallet mark: it is not one of the
   * apps, and drawing it as though it were is how it stops reading as the
   * default that thinks for you.
   *
   * Memoised: a fresh array of seven JSX nodes on every keystroke of the inputs
   * either side of it would re-render the sheet's whole list.
   */
  const methodOptions = useMemo(
    () =>
      METHOD_CHOICES.map((option) => ({
        ...option,
        leading:
          option.value === AUTO_METHOD ? (
            <View className="h-7 w-7 items-center justify-center rounded-lg bg-brand-soft">
              <Ionicons color={colors.primary} name="scan-outline" size={16} />
            </View>
          ) : (
            // 28, not 32: the same node is drawn on the `<Select>` trigger, which
            // is `h-12` and would grow past the `<Input>`s either side of it.
            <WalletMark name={option.value} size={28} />
          ),
      })),
    [colors.primary],
  );

  const attach = useCallback(
    async (picked: {
      fileName?: string | null;
      height?: number;
      mimeType?: string;
      uri: string;
      width?: number;
    }) => {
      // The local uri *is* the preview — `<ReceiptPreview>` draws a screenshot
      // and a PDF from the same file on the phone, so it is on screen before the
      // upload starts rather than after it finishes.
      setProofPreview(picked.uri);
      setProofMimeType(picked.mimeType);
      setProofAssetId(null);
      setErrors((current) => ({ ...current, proofAssetId: undefined }));
      // Whatever was wrong with the last file is not what is wrong with this
      // one. Cleared on the way in so the notice cannot outlive its subject.
      setAttachRejection(null);
      // A new file makes every verdict about the old one wrong, and the read is
      // about to start from `decoding` anyway — clearing here means the strip
      // never shows the previous file's answer over the new file's preview.
      resetEvidence();

      try {
        /*
         * Shrunk to the size the server actually reads, before a byte moves.
         *
         * The recogniser works at a 1600px longest edge, so a 3456 × 4608 camera
         * frame spends ten times the bytes on detail that is discarded before it
         * is ever looked at — up a phone uplink, which is the slowest link in
         * the path and the one the resident is watching. PDFs and screenshots
         * already under the bar come back untouched, and any failure returns the
         * original, so this can only ever cost bytes rather than the claim.
         */
        const upload = await prepareEvidenceForUpload(picked);
        const assetId = await uploadAsset(upload, {
          kind: "PAYMENT_PROOF",
          label: "Payment proof",
          onProgress: setUpload,
        });

        setProofAssetId(assetId);
      } catch (caught) {
        /*
         * The preview is cleared: leaving a thumbnail on screen after a failed
         * upload is how somebody submits believing they attached something.
         *
         * No toast — `uploadAsset` registers with the global upload queue, and
         * the toaster at the root already shows this failure with its reason.
         * Two notices for one event reads as two failures.
         */
        setProofPreview(null);
        setProofMimeType(undefined);
        /*
         * …but a file refused for *what it is* leaves a notice behind, because
         * the toast is the wrong lifetime for it. A dropped connection is over
         * once it is read; "this photo will not open" has to still be on screen
         * when the resident opens the picker again, or they choose the same file
         * and watch it fail identically. `uploadRejection` returns null for the
         * transient cases, which leaves those to the toaster exactly as before.
         */
        const refused = uploadRejection(
          readApiErrorCode(caught),
          readApiError(caught, "That upload did not go through."),
        );

        setAttachRejection(refused);

        // Only the refusals that name the file. The transient ones are already
        // null here, and a "your connection dropped" in the shade is noise the
        // upload toaster has covered.
        if (refused) {
          notifyClaimOutcome(
            { body: refused.detail, title: refused.title, tone: "failure" },
            id,
          );
        }
      } finally {
        setUpload(null);
      }
    },
    [id, resetEvidence],
  );

  const pick = useCallback(
    async (source: "camera" | "library") => {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        toastError(
          "Permission needed",
          source === "camera"
            ? "Allow camera access to photograph your receipt."
            : "Allow photo access to attach your screenshot.",
        );
        return;
      }

      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              quality: 0.8,
            });

      const asset = result.canceled ? null : result.assets[0];

      if (asset) {
        await attach(asset);
      }
    },
    [attach],
  );

  /**
   * The PDF path.
   *
   * A bank receipt arrives as a PDF far more often than as a screenshot, and it
   * reads *better* than one — its text is text, so the server skips OCR
   * entirely and the fields come back exact. Until this existed the image picker
   * was the only way in, so the highest-quality evidence the product can receive
   * was the one kind of file a resident on a phone could not send.
   *
   * `expo-document-picker` is a native module and this project is bare, so it is
   * required inside the handler rather than imported: a binary built before it
   * was added would otherwise throw at module load and take the whole route down
   * as "missing default export". {@link documentPickerAvailable} lets the
   * dropzone leave the line off rather than offer a tap that cannot work.
   */
  const pickDocument = useCallback(async () => {
    const picker = loadDocumentPicker();

    if (!picker) {
      toastError(
        "This build cannot open files",
        "The file picker is a native module added after this app was built. A photo or screenshot still works.",
      );
      return;
    }

    const result = await picker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    });
    const file = result.canceled ? null : result.assets?.[0];

    if (!file) {
      return;
    }

    await attach({
      fileName: file.name,
      mimeType: file.mimeType ?? "application/pdf",
      uri: file.uri,
    });
  }, [attach]);

  const submit = useCallback(async () => {
    // Built here rather than during render: a fresh object every render would
    // change this callback's identity on every keystroke.
    const draft = { amount, method, proofAssetId, transactionCode };
    const problems = validateClaim(draft);

    setErrors(problems);

    /*
     * `!method` is redundant against `hasErrors` — the validator already refuses
     * a null one — and is kept because TypeScript cannot see that, and the
     * request below needs a narrowed `PaymentMethod`.
     */
    if (hasErrors(problems) || !method) {
      return;
    }

    setSubmitting(true);

    try {
      const result = await submitClaim(id, {
        amount: parseClaimAmount(draft.amount) as number,
        paymentMethod: method as PaymentMethod,
        proofImageAssetId: proofAssetId as string,
        referenceNote: note.trim() || undefined,
        transactionCode: transactionCode.trim() || undefined,
      });

      if (result.created) {
        toastSuccess("Proof submitted", "Your hostel will confirm it shortly.");
        /*
         * The one good ending, and the one worth keeping.
         *
         * This screen closes itself the moment the claim lands, so its toast is
         * shown over a *different* screen and is gone seconds later. The
         * notification is the only durable receipt the resident has that their
         * proof went in — which, for a rent payment, is the thing they will want
         * to check again this evening.
         */
        notifyClaimOutcome(
          {
            body: "Your hostel will confirm it shortly.",
            title: "Payment proof submitted",
            tone: "success",
          },
          id,
        );
      } else {
        toastInfo("Already submitted", "We had this proof on file already.");
      }

      router.replace(`/invoice/${id}`);
    } catch (caught) {
      const instant = claimRejection(
        readApiErrorCode(caught),
        readApiError(caught),
        readApiErrorDetails<ClaimRejectionDetails>(caught),
        { day: dates.date, month: dates.period },
      );

      if (instant) {
        // The screenshot is the thing that has to change, so it goes — the
        // resident is one upload away from a valid claim rather than back at the
        // start of the form.
        setProofAssetId(null);
        setProofPreview(null);
        setProofMimeType(undefined);
        setRejection(instant);
        // A submit costs one of eight an hour, so being told it was refused is
        // worth as much as being told it worked — and the resident may have put
        // the phone down the moment they pressed the button.
        notifyClaimOutcome(
          { body: instant.detail, title: instant.title, tone: "failure" },
          id,
        );
        return;
      }

      // Deliberately no retry: the endpoint costs seconds of server CPU per call
      // and allows eight an hour.
      toastError("Could not submit", readApiError(caught));
      notifyClaimOutcome(
        { body: readApiError(caught), title: "Could not submit your proof", tone: "failure" },
        id,
      );
    } finally {
      setSubmitting(false);
    }
  }, [amount, dates.date, dates.period, id, method, note, proofAssetId, transactionCode]);

  /*
   * "Submit payment proof", not "I've paid".
   *
   * The button on the invoice is still "I've paid" and should stay that way — it
   * is the resident's own claim, in their words, and it is what makes them tap.
   * A title has a different job: it names what the screen *is*, and this screen
   * is a form for handing over a receipt. The old title read as a restatement of
   * the button and told a resident arriving here nothing about what was wanted
   * from them; every refusal on the screen asks for a file, so the heading may
   * as well say that a file is the point.
   */
  const header = <AppBar showBack title="Submit payment proof" />;

  if (instructions.loading) {
    return (
      /* The promise, the dropzone, then the three fields. */
      <Screen header={header} scroll>
        <View className="gap-4 pt-1">
          <Skeleton height={64} radius={16} />
          <Skeleton height={18} width="52%" />
          <Skeleton height={168} radius={16} />
          <Skeleton height={72} radius={12} />
          <Skeleton height={72} radius={12} />
          <Skeleton height={72} radius={12} />
        </View>
      </Screen>
    );
  }

  if (instructions.error || !data) {
    return (
      <Screen header={header}>
        <FailureState
          message={instructions.error ?? "This invoice could not be loaded."}
          onRetry={instructions.reload}
          title="Failed to load"
        />
      </Screen>
    );
  }

  if (rejection) {
    return (
      <Screen header={header} scroll>
        <View className="gap-4 pt-1">
          {/* The tone classes are on a plain `<View>` rather than passed to
              `<Card>`: two border-colour rules of equal specificity are settled
              by the order Tailwind generated them in, not by where they sat in
              the string, and the card's own doc says so. One rule, no race. */}
          <View className={`gap-3 rounded-2xl border p-4 ${NOTICE_TONES.danger.wrap}`}>
            <View className="flex-row items-center gap-2">
              <Ionicons color={colors.destructive} name="close-circle" size={22} />
              <Text className="flex-1 text-destructive" variant="subtitle">
                {rejection.title}
              </Text>
            </View>

            <Text variant="body">{rejection.detail}</Text>
          </View>

          <View className="flex-row gap-3">
            <Button
              className="flex-1"
              label="Try again"
              onPress={() => setRejection(null)}
            />
            <Button
              className="flex-1"
              label="Cancel"
              onPress={() => router.back()}
              variant="outline"
            />
          </View>
        </View>
      </Screen>
    );
  }

  const uploading = upload !== null;
  /**
   * A file is attached and we do not yet know what is on it.
   *
   * Written against `proofAssetId` rather than against the reader's own stage,
   * and the difference is a hole in the barrier rather than a nicety. The read
   * starts in an effect, so between the upload resolving and that effect running
   * the stage is still `idle` — and a stage-only test reads that as "no read in
   * progress" and lights the submit button. One tap inside that window sends a
   * claim the read was a frame away from refusing, and spends one of the eight
   * submits an hour to be told so by the server instead.
   *
   * Anything attached is therefore unsubmittable until its read has finished,
   * however it finishes. The timeout in `lib/evidence-reader.ts` is what
   * guarantees that "finished" always arrives.
   */
  const reading = proofAssetId !== null && evidence.stage !== "done";
  /*
   * The submit waits for the read.
   *
   * Not merely cosmetic. The read is what knows whether this file is one the
   * submit path refuses outright, and a resident who taps the moment the upload
   * finishes would spend one of eight submits an hour to be told what the strip
   * two rows up was a second away from saying for free. It also stops the form
   * being sent with the fields the read is about to fill still empty.
   *
   * The web form does not do this, and can afford not to: it is a desktop modal
   * where the button sits under a receipt preview nobody scrolls past in under a
   * second. A phone footer button is under the resident's thumb the entire time.
   */
  const submitLabel = blockReason
    ? "Upload a different file"
    : reading
      ? "Reading your receipt…"
      : proofAssetId
        ? "Submit claim"
        : "Upload your proof first";

  return (
    <Screen
      footer={
        <Button
          disabled={!proofAssetId || uploading || reading || Boolean(blockReason)}
          label={submitLabel}
          loading={submitting}
          onPress={() => void submit()}
        />
      }
      header={header}
      scroll
    >
      <View className="gap-4 pt-1">
        {/*
          What is owed and the quota, in one line each.

          The outstanding figure is not a hero here — this is a form, and the
          number matters only as the thing being confirmed, which it already is
          in the amount field below. What a resident genuinely cannot find out
          elsewhere is the rate limit, so that is what the notice carries.
        */}
        <Notice
          body={
            data.referenceCode
              ? `Reference ${data.referenceCode}. You can submit up to 8 claims per hour.`
              : "You can submit up to 8 claims per hour."
          }
          icon="time-outline"
          title={`Claiming against ${formatMoney(data.amountDue)}`}
        />

        {/* The blocking sentence, at the top rather than beside the button that
            produced it: the submit is pinned to the footer, so a refusal
            rendered next to it would sit below the fold on every phone. */}
        {blockReason ? (
          <Notice icon="close-circle" title={blockReason} tone="danger" />
        ) : null}

        {/* The upload's own refusal — a file that never became an attachment at
            all, so there is nothing below for a read to say anything about. It
            sits here with the same weight as a read's refusal because it asks
            for exactly the same thing: a different file. */}
        {attachRejection ? (
          <Notice
            body={attachRejection.detail}
            icon="close-circle"
            title={attachRejection.title}
            tone="danger"
          />
        ) : null}

        <View className="gap-2">
          <Text variant="label">Payment screenshot or receipt (required)</Text>

          {/*
            Said *before* they upload, not after.

            A resident who does not know the file fills the form in types the
            amount and the ten-digit id first — and the read deliberately does
            not overwrite what they typed, so the feature they were never told
            about is the one that never runs. One sentence in front of the picker
            is what makes uploading first a reason rather than an order.
          */}
          {!proofAssetId && !uploading ? (
            <Notice
              body="We take the amount, the transaction ID and which app you paid with straight off your receipt. Change anything we get wrong."
              icon="scan-outline"
              title="Just upload the proof — we read it and fill the form in below."
              tone="brand"
            />
          ) : null}

          {proofPreview ? (
            <Card className="items-center gap-3">
              {/*
                Drawn from the file on the phone, not from the uploaded asset.

                So it appears the frame it is picked — before the presign, before
                the bytes move, before the read — and a screenshot and a bank's
                PDF both show as themselves. The resident is about to be asked to
                check an amount and a ten-digit id we read *off this document*,
                and neither a spinner nor a filename lets them do that.
              */}
              <ReceiptPreview
                mimeType={proofMimeType}
                onPress={
                  proofAssetId
                    ? () =>
                        openAssetViewer([
                          {
                            assetId: proofAssetId,
                            caption: "The receipt you uploaded",
                            mimeType: proofMimeType,
                            title: "Payment receipt",
                          },
                        ])
                    : undefined
                }
                uri={proofPreview}
              />

              {/*
                Every way in that the dropzone offers, offered again.

                It was `Replace` and `Camera` — the photo library and the camera,
                and no way back to the file browser. So a resident who attached
                the wrong PDF, or whose bank receipt was refused, could not
                choose another one: the only control that opens a PDF is on the
                empty dropzone, and the dropzone is gone the moment anything is
                attached. Swapping the file is the *one* action every refusal on
                this screen asks for, and for PDF evidence it was a dead end.
              */}
              <View className="flex-row gap-2 self-stretch">
                <Button
                  className="flex-1"
                  label="Photos"
                  onPress={() => void pick("library")}
                  variant="outline"
                />
                <Button
                  className="flex-1"
                  label="Camera"
                  onPress={() => void pick("camera")}
                  variant="outline"
                />
                {canPickDocument ? (
                  <Button
                    className="flex-1"
                    label="Files"
                    onPress={() => void pickDocument()}
                    variant="outline"
                  />
                ) : null}
              </View>
            </Card>
          ) : (
            <Dropzone
              onCamera={() => void pick("camera")}
              onDocument={() => void pickDocument()}
              onLibrary={() => void pick("library")}
            />
          )}

          {errors.proofAssetId ? (
            <Text className="text-destructive" variant="caption">
              {errors.proofAssetId}
            </Text>
          ) : null}

          <EvidenceStatus
            /* Blocked beats read.

               Without this the strip answers a different question from the
               banner and wins, because it is the one beside the receipt: a
               credit-side receipt reads perfectly, so `filledAnything` is true
               and this said "We read your receipt and filled in what we found"
               in green, directly under a red refusal. The resident believes the
               half that looks like progress and fills in a form whose submit is
               disabled. */
            blocked={Boolean(blockReason)}
            filledAnything={filled.amount || filled.method || filled.transactionCode}
            notAReceipt={evidence.notAReceipt}
            /* The uploader's leg is reported as one of the reader's stages, so
               the strip follows the file from the phone to the recognised
               numbers instead of appearing out of nowhere a second later. */
            stage={uploading ? "uploading" : evidence.stage}
            statementGuidance={evidence.statementGuidance}
            unreadable={evidence.unreadable}
          />
        </View>

        <View className="gap-1.5">
          <Input
            error={errors.amount}
            hint={
              filled.amount ? undefined : "Edit it if you paid part of the month."
            }
            inputMode="numeric"
            keyboardType="number-pad"
            label="Amount"
            onChangeText={(value) =>
              setEdits((current) => ({ ...current, amount: value }))
            }
            placeholder="0"
            value={amount}
          />

          {filled.amount ? (
            <ReadOffReceipt
              text={
                parseClaimAmount(amount) !== data.amountDue && data.amountDue > 0
                  ? `Read from your receipt — this invoice's balance is ${formatMoney(data.amountDue)}`
                  : "Read from your receipt"
              }
            />
          ) : null}
        </View>

        <View className="gap-1.5">
          <Select
            error={errors.method}
            label="Method"
            onChange={(value) =>
              setEdits((current) => ({ ...current, method: value }))
            }
            options={methodOptions}
            placeholder="Select method"
            sheetTitle="How did you pay?"
            value={selection}
          />

          {/* One line, and only when it says something. Auto that has resolved
              reports what it read; Auto that has not stays quiet rather than
              explaining itself before there is a file to explain. */}
          {filled.method ? (
            <ReadOffReceipt
              text={`Read from your receipt: ${methodLabel(detected)}`}
            />
          ) : null}
        </View>

        <View className="gap-1.5">
          <Input
            /* A transaction id is copied, not composed, so autocorrect and
               autocapitalisation are only ever wrong about it. */
            autoCapitalize="characters"
            autoCorrect={false}
            error={errors.transactionCode}
            hint={
              filled.transactionCode
                ? undefined
                : isCash
                  ? "The warden or owner who took it."
                  : "UTR, txn id or reference id."
            }
            label={
              isCash
                ? "Who did you give the cash to?"
                : transactionCodeRequired(method)
                  ? "Transaction ID"
                  : "Transaction ID (optional)"
            }
            onChangeText={(value) =>
              setEdits((current) => ({ ...current, transactionCode: value }))
            }
            placeholder={isCash ? "Enter their name" : "Enter transaction ID"}
            value={transactionCode}
          />

          {filled.transactionCode ? (
            <ReadOffReceipt text="Read from your receipt — check it matches" />
          ) : null}

          {/* Cash has no id to hunt for, so the helper would point at a screen
              that does not exist. A sheet rather than an inline expander:
              `NOTES.md` §6 is explicit that what a row opens is a sheet, and
              three steps pushed into the middle of a form move both fields
              around it. */}
          {isCash ? null : (
            <Pressable
              accessibilityRole="button"
              className="flex-row items-center gap-1.5 self-start active:opacity-70"
              hitSlop={8}
              onPress={() => setWhereOpen(true)}
            >
              <Ionicons color={colors.primary} name="help-circle-outline" size={14} />
              <Text className="text-primary" variant="caption">
                Show me where to find this
              </Text>
            </Pressable>
          )}
        </View>

        {/*
          The reference code, in whichever state this upload has reached.

          Once the receipt has been read we *know* whether the code is on it, so
          asking the resident to confirm they used it would be asking a question
          we have already answered, and answered better. Nothing at all while the
          file is one of ours: the code genuinely is on it — we printed it there —
          so every state of this block would be encouragement to submit the one
          file that cannot be accepted.
        */}
        {evidence.systemDocument ? null : evidence.reference ? (
          <ReferenceState
            code={evidence.reference.code}
            state={evidence.reference.found ? "confirmed" : "missed"}
          />
        ) : data.referenceCode ? (
          <ReferenceState code={data.referenceCode} state="reminder" />
        ) : null}

        <Input
          hint="Optional."
          label="Anything your hostel should know?"
          maxLength={200}
          multiline
          onChangeText={setNote}
          placeholder="Paid from my brother's eSewa, etc."
          value={note}
        />

        {/*
          The things that get a claim rejected, said before it is submitted
          rather than after. A rejection round-trip costs the resident a day and
          the hostel a review; four lines of caption cost neither.
        */}
        <View className="gap-1.5">
          <Text variant="label">Tips</Text>
          <Tip text="Just upload the proof — we read it and fill the form in for you." />
          <Tip text="Make sure the amount, the date and the transaction ID are visible." />
          <Tip text="Send the receipt for this payment, not one you have sent before." />
          <Tip text="Supported: JPG, PNG, WEBP and PDF (max 10MB)." />
        </View>
      </View>

      <Sheet
        onClose={() => setWhereOpen(false)}
        open={whereOpen}
        title="Where to find the transaction ID"
      >
        <View className="gap-3 pb-2">
          {whereToLook(method).map((step, index) => (
            <View className="flex-row items-start gap-3" key={step}>
              <View className="h-6 w-6 items-center justify-center rounded-full bg-brand-soft">
                <Text className="text-primary" variant="caption">
                  {index + 1}
                </Text>
              </View>
              <Text className="flex-1" variant="body">
                {step}
              </Text>
            </View>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

/** The `<Select>`'s word for a method, for the "we read it" line. */
function methodLabel(value: string | null): string {
  return CLAIM_METHODS.find((option) => option.value === value)?.label ?? "your app";
}

/**
 * What is happening to the receipt, while it is happening.
 *
 * The stages come from the server as it reaches them, so this is a report rather
 * than an animation — if the decode is slow, "Opening your receipt" is what
 * stays on screen, because that is what is actually slow.
 *
 * **It always says something once a read has finished.** An earlier shape
 * returned null on the quiet outcomes, so a read that succeeded and filled
 * nothing in — a receipt carrying only the reference code — left the resident
 * watching a spinner vanish into silence.
 *
 * The blocking verdicts are deliberately absent: they are drawn once, at the top
 * of the form, where the eye returns after a failed submit. Printing them here
 * as well would be two notices for one refusal.
 */
function EvidenceStatus({
  blocked,
  filledAnything,
  notAReceipt,
  stage,
  statementGuidance,
  unreadable,
}: {
  blocked: boolean;
  filledAnything: boolean;
  notAReceipt: boolean;
  stage: EvidenceStage;
  statementGuidance: string | null;
  unreadable: boolean;
}) {
  const { colors } = useAppTheme();

  if (stage === "idle") {
    return null;
  }

  /*
   * A blocked file has one thing to say and the banner is already saying it.
   *
   * Silent rather than repeating the sentence: the refusal is long — it names
   * the account or the direction that was read — and printing it twice on a
   * phone pushes the picker off the screen, which is the one control the
   * resident needs. Every other branch below describes a file they may still
   * submit, and none of those descriptions is true of this one.
   */
  if (blocked && stage === "done") {
    return null;
  }

  if (stage !== "done") {
    return (
      <View
        className={`flex-row items-center gap-2.5 rounded-2xl border p-4 ${NOTICE_TONES.brand.wrap}`}
      >
        <ActivityIndicator color={colors.primary} size="small" />
        <Text className="flex-1 text-primary" variant="label">
          {STAGE_LABELS[stage]}
        </Text>
      </View>
    );
  }

  /*
   * A statement is a real payment record and their payment is probably on it, so
   * this never blocks. What it does is ask for the one file that settles in a
   * glance instead of the one a reviewer has to search.
   */
  if (statementGuidance) {
    return (
      <Notice
        body={statementGuidance}
        icon="alert-circle"
        title="That is a statement, not a receipt"
        tone="warning"
      />
    );
  }

  /*
   * The loudest thing that still lets them through, and the only one that is a
   * fact about their file rather than about our software: they can fix it now,
   * in ten seconds.
   */
  if (notAReceipt) {
    return (
      <Notice
        body="We could not find a payment app, an amount or a transaction ID on it. Check you picked the right file — you can still submit, but your hostel will have to look at it by hand."
        icon="alert-circle"
        title="This does not look like a payment receipt"
        tone="warning"
      />
    );
  }

  if (filledAnything) {
    return (
      <Notice
        icon="scan"
        title="We read your receipt and filled in what we found. Please check it."
        tone="success"
      />
    );
  }

  return (
    <Notice
      icon="scan-outline"
      title={
        unreadable
          ? "We could not read this one — please fill in the amount and transaction ID yourself."
          : "Uploaded. Please fill in the amount and transaction ID."
      }
    />
  );
}

/**
 * The reference code, in one of its three states.
 *
 * Informational in all of them, never a gate. A resident who forgot the code has
 * still paid, and blocking the claim would leave real money with no way to be
 * reported — it costs the owner a manual match, which is exactly what the
 * owner's review queue is for.
 */
function ReferenceState({
  code,
  state,
}: {
  code: string;
  state: "confirmed" | "missed" | "reminder";
}) {
  const copy = {
    confirmed: {
      body: "Your hostel can match this payment automatically.",
      icon: "checkmark-circle" as const,
      title: `We found ${code} on your receipt`,
      tone: "success" as const,
    },
    missed: {
      body: "Submit anyway — your hostel will match it by hand. Next time, put the code in the remarks.",
      icon: "alert-circle" as const,
      title: `We could not find ${code} on your receipt`,
      tone: "warning" as const,
    },
    reminder: {
      body: "Put it in the remarks when you pay, so your hostel can match it automatically.",
      icon: "pricetag-outline" as const,
      title: `Your reference code is ${code}`,
      tone: "plain" as const,
    },
  }[state];

  return (
    <Notice body={copy.body} icon={copy.icon} title={copy.title} tone={copy.tone} />
  );
}

/**
 * The tinted surfaces this screen draws, as one table.
 *
 * Deliberately a plain `<View>` rather than a `<Card>` with the tone appended.
 * `Card` already sets `border-border`, and two border-colour utilities of equal
 * specificity are settled by the order Tailwind generated them in rather than by
 * where they sat in the string — the trap the component's own doc names. One
 * border rule per surface means there is nothing to settle.
 *
 * `/30` and `/40` rather than the solid tone: a fully saturated border around a
 * soft fill reads as a control that can be pressed, and none of these can.
 */
const NOTICE_TONES = {
  brand: { icon: "primary", wrap: "border-primary/30 bg-brand-soft" },
  danger: { icon: "destructive", wrap: "border-destructive/40 bg-destructive-soft" },
  plain: { icon: "mutedForeground", wrap: "border-border bg-card" },
  success: { icon: "success", wrap: "border-success/30 bg-success-soft" },
  warning: { icon: "warning", wrap: "border-warning/40 bg-warning-soft" },
} as const;

/**
 * A glyph, a sentence and — where there is more to say — a caption under it.
 *
 * Six of these on one screen is why it is a component: the alternative is six
 * hand-built rows that drift apart on icon size, gap and which of the two lines
 * carries the emphasis. Every tone is one of the semantic ones; none is a hex.
 */
function Notice({
  body,
  icon,
  title,
  tone = "plain",
}: {
  body?: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  tone?: keyof typeof NOTICE_TONES;
}) {
  const { colors } = useAppTheme();
  const palette = NOTICE_TONES[tone];

  return (
    <View
      className={`flex-row items-start gap-2.5 rounded-2xl border p-4 ${palette.wrap}`}
    >
      <Ionicons color={colors[palette.icon]} name={icon} size={18} />
      <View className="flex-1 gap-0.5">
        <Text variant="label">{title}</Text>
        {body ? <Text variant="caption">{body}</Text> : null}
      </View>
    </View>
  );
}

/** The green attribution under a field the resident did not type. */
function ReadOffReceipt({ text }: { text: string }) {
  const { colors } = useAppTheme();

  return (
    <View className="flex-row items-center gap-1.5">
      <Ionicons color={colors.success} name="scan" size={13} />
      <Text className="flex-1 text-success" variant="caption">
        {text}
      </Text>
    </View>
  );
}

/**
 * The empty picker.
 *
 * Press targets in one dashed box, because the box is one *slot* and the ways to
 * fill it are not different jobs. `Tap to upload` takes the whole area — the
 * common case is a screenshot the resident already has — and the two smaller
 * targets inside it are the paper receipt and the bank's PDF.
 *
 * The inner `<Pressable>`s stop propagation implicitly: React Native does not
 * bubble a handled press to an ancestor `Pressable`, so tapping the camera line
 * does not also open the library.
 */
function Dropzone({
  onCamera,
  onDocument,
  onLibrary,
}: {
  onCamera: () => void;
  onDocument: () => void;
  onLibrary: () => void;
}) {
  const { colors } = useAppTheme();
  // Once per mount: whether the module is linked cannot change while running.
  const [canPickDocument] = useState(() => loadDocumentPicker() !== null);

  return (
    <Pressable
      accessibilityHint="Opens your photo library"
      accessibilityLabel="Upload a payment screenshot"
      accessibilityRole="button"
      className="items-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/20 px-6 py-8 active:opacity-70"
      onPress={onLibrary}
    >
      <View className="h-12 w-12 items-center justify-center rounded-full bg-brand-soft">
        <Ionicons color={colors.primary} name="cloud-upload-outline" size={24} />
      </View>

      <Text className="text-center" variant="label">
        Tap to upload
      </Text>

      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityHint="Opens the camera"
          accessibilityLabel="Take a photo of your receipt"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onCamera}
        >
          <Text className="text-primary" variant="caption">
            or take a photo
          </Text>
        </Pressable>

        {canPickDocument ? (
          <>
            <Text variant="caption">·</Text>
            <Pressable
              accessibilityHint="Opens your files"
              accessibilityLabel="Choose a PDF receipt"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onDocument}
            >
              <Text className="text-primary" variant="caption">
                or choose a PDF
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>

      <Text className="text-center" variant="caption">
        Clear, full screenshot of the payment
      </Text>
    </Pressable>
  );
}

function Tip({ text }: { text: string }) {
  const { colors } = useAppTheme();

  return (
    <View className="flex-row items-start gap-2">
      <Ionicons
        color={colors.mutedForeground}
        name="ellipse"
        size={5}
        style={{ marginTop: 7 }}
      />
      <Text className="flex-1" variant="caption">
        {text}
      </Text>
    </View>
  );
}

/** What `expo-document-picker` hands back. Only the fields the upload needs. */
type PickedDocument = { mimeType?: string; name: string; size?: number; uri: string };

type DocumentPickerModule = {
  getDocumentAsync: (options: {
    type?: string[];
  }) => Promise<{ assets: PickedDocument[] | null; canceled: boolean }>;
};

/**
 * `expo-document-picker`, loaded only when somebody actually picks a file.
 *
 * The same guard `manage/statements.tsx` uses, and for the same reason: it is a
 * native module, this project is bare, and a top-level import of one absent from
 * the *binary* throws at module load — which expo-router reports as "Route is
 * missing the required default export", killing a screen whose photo path needs
 * no native code at all.
 *
 * `require` rather than `await import()`: a dynamic import is a promise Metro
 * still resolves eagerly at bundle time.
 */
function loadDocumentPicker(): DocumentPickerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-document-picker") as DocumentPickerModule;
  } catch {
    return null;
  }
}
