import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { CopyButton } from "@/components/pay-methods";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyCard, FailureState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  getPlanPayInstructions,
  type PlanPayInstructions,
  submitPlanPaymentClaim,
} from "@/lib/admin-api";
import { readApiError } from "@/lib/api-contract";
import { openConfirm } from "@/lib/confirm";
import { downloadToDevice } from "@/lib/documents";
import { prepareEvidenceForUpload } from "@/lib/evidence-image";
import { formatMoney } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { uploadAsset, type UploadProgress } from "@/lib/uploads";

/**
 * Paying the platform for this hostel's plan — by hand, for now.
 *
 * ## What this screen replaced
 *
 * A `Pay now` button on Home that opened a confirm dialog and, on **Record
 * payment**, posted a two-step `open`/`confirm` pair at a route that had
 * dropped both branches. The best case was a toast saying "Payment recorded"
 * for money nobody had received; the usual case was the server refusing the
 * second call and the owner reading *"This invoice is already settled in full"*
 * under a balance of Rs 3,600. Both were the same mistake: a **client** was
 * being asked to assert that money arrived.
 *
 * Nothing on this screen asserts that. It shows the owner where to send the
 * money and collects their evidence that they did; a person on the platform
 * side turns that into a payment. The due only clears when the balance actually
 * moves.
 *
 * ## The order is the order somebody does it in
 *
 * 1. **How much, against what** — with the invoice number to quote, given the
 *    copy treatment `invoice/[id]/pay.tsx` gives a reference code, and for the
 *    same reason: it is typed into a *second* device, and a mistyped one is
 *    what makes a reviewer hunt.
 * 2. **The QR** — ours, out of the operations config, with the account name
 *    under it so the owner can check the name on their own screen before they
 *    confirm. That check is the only thing standing between this and a swapped
 *    QR, which is why the label is a field of its own rather than a caption we
 *    invent here. Saving it goes through the global downloader.
 * 3. **Why it is manual**, said plainly and once.
 * 4. **The proof** — attach, reference, note, submit.
 *
 * ## A claim already in review replaces steps 2 to 4 entirely
 *
 * Not a banner above them — the whole lower half of the screen goes. An owner
 * who has paid and is waiting on us must not be looking at a QR and a submit
 * button, because the natural reading of those is that the first attempt did
 * not take. Paying us twice is a real cost and a refund we have no rail for.
 *
 * ## The submit is behind `openConfirm`
 *
 * The app's own dialog, as every other committing action uses. The question it
 * asks is worth asking: submitting is a claim we will act on, and an owner who
 * attached the wrong screenshot has one chance to notice before it reaches a
 * queue.
 */

/** The attached file, once its bytes are actually on our side. */
type Proof = {
  assetId: string;
  /** Local `file://` URI, for the thumbnail. Never the uploaded copy. */
  preview: string;
};

export default function PayPlanScreen() {
  const { colors } = useAppTheme();
  const dates = useDates();

  const instructions = useResource<PlanPayInstructions>(
    useCallback(() => getPlanPayInstructions(), []),
  );

  const [proof, setProof] = useState<Proof | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  /*
   * Which pick the screen is currently showing. A second pick while the first
   * is still uploading must not be overwritten by the first one landing — the
   * same guard the resident claim form carries, and the same reason.
   */
  const attempt = useRef(0);

  const data = instructions.data;
  /*
   * Read out once. `data?.qr` as a dependency defeats the compiler's manual
   * memoization check — an optional chain is a new expression each render, not
   * a stable value it can track.
   */
  const qr = data?.qr ?? null;
  const header = <AppBar showBack title="Pay your plan" />;

  const attach = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    attempt.current += 1;
    const ticket = attempt.current;

    setProof(null);
    setUpload({ fraction: 0, stage: "presigning" });

    try {
      /*
       * Downscaled before it leaves the phone. A 12-megapixel photograph of a
       * bank screen carries no more information than a 1600px one and goes up a
       * phone uplink, which is the slowest link in the path. Any failure returns
       * the original, so this can only cost bytes.
       */
      const prepared = await prepareEvidenceForUpload({
        fileName: asset.fileName,
        height: asset.height,
        mimeType: asset.mimeType,
        uri: asset.uri,
        width: asset.width,
      });

      const assetId = await uploadAsset(prepared, {
        kind: "PAYMENT_PROOF",
        label: "Payment proof",
        onProgress: setUpload,
      });

      if (attempt.current === ticket) {
        setProof({ assetId, preview: asset.uri });
      }
    } catch (caught) {
      if (attempt.current !== ticket) return;

      /*
       * The row is cleared rather than left showing a thumbnail. A picture on
       * screen after a failed upload is how somebody submits believing they
       * attached something.
       */
      setProof(null);
      toastError("That did not attach", readApiError(caught));
    } finally {
      if (attempt.current === ticket) {
        setUpload(null);
      }
    }
  }, []);

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

      const picked = result.canceled ? null : result.assets[0];

      if (picked) {
        await attach(picked);
      }
    },
    [attach],
  );

  const saveQr = useCallback(async () => {
    if (!qr) return;

    setSaving(true);

    try {
      await downloadToDevice({
        /*
         * The collection QR lives in the **public** bucket, and public storage
         * reads any `Authorization` header as a signature and refuses the whole
         * request. This is the one download in the app that must go up bare.
         */
        authenticated: false,
        extension: "png",
        fileName: "HostelHub-payment-QR",
        label: "Payment QR",
        mimeType: "image/png",
        url: qr.url,
      });
    } catch (error) {
      toastError(
        "Could not save it",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }, [qr]);

  const submit = useCallback(() => {
    if (!proof || !data) return;

    openConfirm({
      cancelLabel: "Not yet",
      confirmLabel: "Submit proof",
      message: `We will check your proof for ${formatMoney(data.amountDue)} and email you within 1–2 working days. Your plan keeps working in the meantime.`,
      onConfirm: async () => {
        try {
          await submitPlanPaymentClaim({
            note: note.trim() || undefined,
            proofAssetId: proof.assetId,
            reference: reference.trim() || undefined,
          });

          toastSuccess(
            "Proof sent",
            "We will email you as soon as it is verified.",
          );

          /*
           * Back to where they came from, not a stay-and-refresh. The screen's
           * job is done and its next state is "waiting on us", which the due
           * card on Home now says on its own — leaving them here would show
           * them the same screen with its form removed and read as a failure.
           */
          router.back();
        } catch (error) {
          toastError("Could not send it", readApiError(error));
        }
      },
      title: "Send this to us?",
    });
  }, [data, note, proof, reference]);

  if (instructions.loading) {
    return (
      <Screen header={header} scroll>
        <View className="gap-4 pt-1">
          <Skeleton height={132} radius={16} />
          <Skeleton height={18} width="38%" />
          <Skeleton height={240} radius={16} />
          <Skeleton height={18} width="46%" />
          <Skeleton height={170} radius={16} />
        </View>
      </Screen>
    );
  }

  if (instructions.error || !data) {
    return (
      <Screen header={header}>
        <FailureState
          message={instructions.error ?? "Payment details could not be loaded."}
          onRetry={instructions.reload}
          title="Couldn't load this"
        />
      </Screen>
    );
  }

  if (!data.invoice || data.amountDue <= 0) {
    return (
      <Screen header={header}>
        <EmptyCard
          description="There is nothing outstanding on your plan right now, so there is nothing to pay."
          title="Nothing due"
        />
      </Screen>
    );
  }

  const inReview = data.claim;

  return (
    <Screen
      header={header}
      onRefresh={instructions.refresh}
      refreshing={instructions.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <AmountCard instructions={data} />

        {inReview ? (
          <InReviewCard
            amount={inReview.amount}
            sent={dates.dateLong(inReview.claimedAt)}
          />
        ) : (
          <>
            <View>
              <SectionHeader title="Scan to pay" />
              <Card className="gap-3">
                {qr ? (
                  <>
                    {/*
                      Centred and large. This is the one object on the screen a
                      second phone has to focus on, and a QR scaled down to fit
                      a card's rhythm is a QR that will not read.
                    */}
                    <View className="items-center gap-2 py-1">
                      <View className="overflow-hidden rounded-2xl border border-border bg-white p-2">
                        <Image
                          contentFit="contain"
                          source={{ uri: qr.url }}
                          style={{ height: 220, width: 220 }}
                          transition={150}
                        />
                      </View>

                      {/*
                        The account name, and it is not decoration. The owner
                        reads it against the name their own wallet shows before
                        they confirm — the only check there is against a swapped
                        image.
                      */}
                      <Text className="text-center" variant="label">
                        {qr.label}
                      </Text>
                      <Text className="text-center" variant="caption">
                        Check this name matches what your app shows before you
                        confirm.
                      </Text>
                    </View>

                    <RowDivider />

                    <ListRow
                      busy={saving}
                      icon="download-outline"
                      onPress={() => void saveQr()}
                      subtitle="To scan it from another phone"
                      title="Save the QR"
                    />
                  </>
                ) : (
                  /*
                    Nothing configured. Not an error and not an empty state —
                    the money is still owed and there is still a way to send it,
                    so this says what to do rather than only what is missing.
                  */
                  <View className="flex-row items-start gap-2.5">
                    <Ionicons
                      color={colors.warning}
                      name="alert-circle-outline"
                      size={18}
                    />
                    <Text className="flex-1" variant="muted">
                      No payment QR has been published yet. Contact us for the
                      account details, then send your proof below.
                    </Text>
                  </View>
                )}
              </Card>
            </View>

            <ManualNotice />

            <ProofSection
              note={note}
              onNote={setNote}
              onPick={(source) => void pick(source)}
              onReference={setReference}
              onRemove={() => {
                attempt.current += 1;
                setProof(null);
                setUpload(null);
              }}
              proof={proof}
              reference={reference}
              upload={upload}
            />

            {/*
              Mounted only once there is something to send. It carried a
              permanently disabled button for a while, which spends a footer's
              height narrating its own unavailability — the same argument
              `invoice/[id]/claim.tsx` makes about its submit bar.
            */}
            {proof ? (
              <Button
                label="Submit payment proof"
                onPress={submit}
                size="lg"
              />
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}

/**
 * How much, for what, and the number to quote.
 *
 * One card, one hairline, both halves — the shape `invoice/[id]/pay.tsx`
 * settled on after shipping them as two cards and finding that a border between
 * the amount and the reference made the code look like a separate topic.
 */
function AmountCard({ instructions }: { instructions: PlanPayInstructions }) {
  const dates = useDates();
  /*
   * The server's, not `Date.now()`. Reading the clock during render is impure —
   * the answer changes under a re-render nobody asked for — and it is the same
   * rule `manage/billing.tsx` follows for its day counts: one authority decides,
   * every client prints.
   */
  const overdue = instructions.overdue;

  return (
    <Card className="gap-4">
      <View className="gap-1">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="flex-1" variant="caption">
            Amount due
          </Text>
          {instructions.dueBy ? (
            <Badge
              label={
                overdue
                  ? "Overdue"
                  : `Pay by ${dates.dayMonth(instructions.dueBy)}`
              }
              tone={overdue ? "danger" : "warning"}
            />
          ) : null}
        </View>

        <Money owed size="display" value={instructions.amountDue} />

        {instructions.invoice ? (
          <Text variant="muted">{instructions.invoice.planName}</Text>
        ) : null}
      </View>

      {instructions.reference ? (
        <>
          <View className="h-px bg-border" />
          <View className="gap-2">
            <Text variant="caption">Put this in the remarks</Text>
            <View className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-xl font-bold tracking-wider text-foreground">
                {instructions.reference}
              </Text>
              <CopyButton
                label="invoice number"
                tone="glyph"
                value={instructions.reference}
              />
            </View>
            <Text variant="caption">
              It is how we match your payment to this invoice without having to
              ask you.
            </Text>
          </View>
        </>
      ) : null}
    </Card>
  );
}

/**
 * Why there is no *Pay* button on a payment screen.
 *
 * One short paragraph, stated once, in the owner's terms. It is here because a
 * screen that asks somebody to leave for their banking app and come back with a
 * screenshot owes them the reason — without it the flow reads as unfinished
 * rather than deliberate, and the first thing a hostel owner does with software
 * that looks unfinished is stop trusting the balance on it.
 *
 * `--info` and nothing else: this explains, it does not warn. Painting it amber
 * would make an ordinary instalment look like a problem.
 */
function ManualNotice() {
  const { colors } = useAppTheme();

  return (
    <Card className="flex-row items-start gap-2.5">
      <Ionicons
        color={colors.info}
        name="information-circle-outline"
        size={18}
      />
      <Text className="flex-1" variant="caption">
        Automatic payment is coming soon. Until it is ready, plan payments reach
        us this way — scan, pay, and send us the proof. Thank you for bearing
        with the extra step.
      </Text>
    </Card>
  );
}

/**
 * The claim already with us.
 *
 * It replaces the QR and the form rather than sitting above them, and it says
 * the date the proof was sent because that is the fact the owner is measuring
 * our promise against. See this file's header for why the rest of the screen
 * goes.
 */
function InReviewCard({ amount, sent }: { amount: number; sent: string }) {
  const { colors } = useAppTheme();

  return (
    <Card className="gap-3 border-warning/40 bg-warning/5">
      <View className="flex-row items-start gap-2.5">
        <Ionicons color={colors.warning} name="time-outline" size={20} />
        <View className="flex-1 gap-1">
          <Text variant="subtitle">We are checking your payment</Text>
          <Text variant="caption">
            {`You sent us proof of ${formatMoney(amount)} on ${sent}.`}
          </Text>
        </View>
      </View>

      <RowDivider />

      <Text variant="caption">
        Our team verifies it within 1–2 working days and emails you either way.
        Your plan keeps working and your listing stays live in the meantime —
        there is nothing else for you to do, and nothing more to pay.
      </Text>
    </Card>
  );
}

/**
 * Attach, reference, note.
 *
 * The attach control is **two tiles** rather than a row that opens a chooser:
 * the two sources are the whole menu, and a menu of two behind a tap is a tap
 * spent on nothing. It follows `NOTES.md` §3 — a menu of destinations is a grid
 * of tinted glyphs, never full-width rows of sentences.
 *
 * Both text fields are optional and say so, because both usually are: the
 * remark carries the invoice number already, and the screenshot carries the
 * transaction id. They exist for the payment that went out with neither, which
 * is the one a reviewer would otherwise have to write back about.
 */
function ProofSection({
  note,
  onNote,
  onPick,
  onReference,
  onRemove,
  proof,
  reference,
  upload,
}: {
  note: string;
  onNote: (value: string) => void;
  onPick: (source: "camera" | "library") => void;
  onReference: (value: string) => void;
  onRemove: () => void;
  proof: Proof | null;
  reference: string;
  upload: UploadProgress | null;
}) {
  const { colors } = useAppTheme();
  const busy = Boolean(upload);

  return (
    <View>
      <SectionHeader
        subtitle="A screenshot from your banking app, showing the amount and the date."
        title="Send us the proof"
      />

      <Card className="gap-4">
        {proof ? (
          <View className="flex-row items-center gap-3">
            <Image
              contentFit="cover"
              source={{ uri: proof.preview }}
              style={{ borderRadius: 12, height: 64, width: 64 }}
            />
            <View className="flex-1 gap-0.5">
              <Text variant="label">Screenshot attached</Text>
              <Text variant="caption">Ready to send</Text>
            </View>
            <Pressable
              accessibilityLabel="Remove the attached screenshot"
              accessibilityRole="button"
              className="active:opacity-60"
              hitSlop={10}
              onPress={onRemove}
            >
              <Ionicons
                color={colors.mutedForeground}
                name="close-circle"
                size={22}
              />
            </Pressable>
          </View>
        ) : busy ? (
          <View className="flex-row items-center gap-3">
            <Skeleton height={64} radius={12} width={64} />
            <View className="flex-1 gap-1">
              <Text variant="label">
                {upload?.stage === "verifying" ? "Checking it…" : "Uploading…"}
              </Text>
              <Text variant="caption">
                {upload?.fraction === null || upload?.fraction === undefined
                  ? "This takes a moment on a slow connection."
                  : `${Math.round(upload.fraction * 100)}%`}
              </Text>
            </View>
          </View>
        ) : (
          <View className="flex-row gap-3">
            <PickTile
              icon="camera-outline"
              label="Take a photo"
              onPress={() => onPick("camera")}
            />
            <PickTile
              icon="image-outline"
              label="From gallery"
              onPress={() => onPick("library")}
            />
          </View>
        )}

        <RowDivider />

        <Input
          autoCapitalize="characters"
          hint="Optional — the code your bank or wallet gave you."
          label="Transaction reference"
          onChangeText={onReference}
          placeholder="e.g. 0GD8K2LM"
          value={reference}
        />

        <Input
          hint="Optional — anything we should know about this payment."
          label="Note for our team"
          multiline
          onChangeText={onNote}
          placeholder="Paid from a different account, and so on."
          value={note}
        />
      </Card>
    </View>
  );
}

/** One of the two ways in. A tinted glyph over a short label, per `NOTES.md` §3. */
function PickTile({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="flex-1 items-center gap-2 rounded-2xl border border-dashed border-border py-5 active:opacity-70"
      onPress={onPress}
    >
      <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand-soft">
        <Ionicons color={colors.primary} name={icon} size={20} />
      </View>
      <Text variant="label">{label}</Text>
    </Pressable>
  );
}
