import { useCallback, useMemo, useState } from "react";
import { Linking, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Avatar } from "@/components/ui/avatar";
import { StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/layout";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { EmptyCard, ErrorState } from "@/components/ui/states";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  type InquiryStatus,
  type ManagedInquiry,
  setInquiryStatus,
} from "@/lib/admin-manage-api";
import { adminQuery } from "@/lib/admin-queries";
import { readApiError } from "@/lib/api-contract";
import { humanizeEnum } from "@/lib/format";
import {
  type InquiryBucket,
  inquiryActions,
  inquiryCounts,
  inquiriesIn,
} from "@/lib/inquiries";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Leads — the queue behind the red count on Home.
 *
 * ## Why this screen exists at all
 *
 * Home's `New inquiries` tile used to open the **Residents** tab, and that was
 * wrong in the way that is hardest to notice: it looked like it worked. The
 * roster is a directory of people who already live here, an inquiry is somebody
 * asking whether they could — so the tap landed on a list that did not contain
 * the thing it was counting, and the red badge that sent you there had no way of
 * being cleared once you arrived. A count nobody can act on trains people to
 * stop looking at counts.
 *
 * `(admin)/alerts` does carry leads, as one of four kinds in a triage feed. That
 * is the right home for *is anything waiting*, and the wrong one for working
 * through fifteen of them: the feed is ranked by consequence, so leads sit under
 * every SOS, complaint and payment claim, and nothing there says how many have
 * been answered.
 *
 * ## Marking one read is a real write, not a local flag
 *
 * There is no `read` field on an inquiry, and adding a client-side one would
 * make the app disagree with the web portal about the same lead. "Mark read"
 * writes `CONTACTED` — the server's own word for *somebody has picked this up* —
 * which is what removes it from the `status=NEW` pull the Home count is built
 * from. So the badge clears because the record changed, not because this screen
 * hid something.
 *
 * See `lib/inquiries.ts` for why five statuses are shown under three segments,
 * and why the buttons on a card depend on where the lead already is.
 *
 * ## No compose button
 *
 * A lead arrives from the public site or a referral link. There is no route that
 * creates one from the hostel side, and a hostel typing in somebody who rang the
 * doorbell is registering a resident, which is `manage/resident/new`.
 */

const SEGMENTS: { bucket: InquiryBucket; label: string }[] = [
  { bucket: "new", label: "New" },
  { bucket: "working", label: "Working" },
  { bucket: "done", label: "Done" },
];

export default function ManageInquiriesScreen() {
  const dates = useDates();

  // Warmed on portal entry: Home's "New inquiries" tile carries the count that
  // sends people here, so this is a queue an owner opens because they were
  // already told there was something in it.
  const query = adminQuery.inquiries();
  const inquiries = useResource<ManagedInquiry[]>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const [bucket, setBucket] = useState<InquiryBucket>("new");
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => inquiries.data ?? [], [inquiries.data]);
  const counts = useMemo(() => inquiryCounts(rows), [rows]);
  const listed = useMemo(() => inquiriesIn(rows, bucket), [bucket, rows]);

  const { reload } = inquiries;

  const move = useCallback(
    async (inquiry: ManagedInquiry, status: InquiryStatus) => {
      setBusyId(inquiry.id);

      try {
        await setInquiryStatus(inquiry.id, status);
        toastSuccess(
          `Marked ${humanizeEnum(status).toLowerCase()}`,
          status === "CONTACTED"
            ? "It has left the new-inquiry count on Home."
            : undefined,
        );
        await reload();
      } catch (error) {
        toastError("Could not update", readApiError(error, "That did not save."));
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  const header = <AppBar accent centerTitle showBack title="Leads" />;

  if (inquiries.error) {
    return (
      <Screen header={header}>
        {/*
          The server's own wording. A warden without the grant is told about the
          permission rather than shown an empty queue, which would read as "no
          one has enquired" — the mistake `PermissionCard` exists to prevent.
        */}
        <ErrorState message={inquiries.error} onRetry={inquiries.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      header={header}
      onRefresh={inquiries.refresh}
      refreshing={inquiries.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <Segmented
          onChange={setBucket}
          options={SEGMENTS.map((segment) => ({
            count: counts[segment.bucket],
            label: segment.label,
            value: segment.bucket,
          }))}
          value={bucket}
        />

        {/* Skeletons, not a spinner — NOTES §9. */}
        {inquiries.loading ? <SkeletonRows rows={4} /> : null}

        {!inquiries.loading && listed.length === 0 ? (
          <EmptyCard
            description={
              bucket === "new"
                ? "Every enquiry from your listing has been picked up."
                : bucket === "working"
                  ? "Nothing is mid-conversation. New leads arrive under New."
                  : "Nothing has been converted or closed yet."
            }
            title={bucket === "new" ? "Nothing waiting" : "Nothing here"}
          />
        ) : null}

        {listed.map((inquiry) => (
          <InquiryCard
            busy={busyId === inquiry.id}
            date={inquiry.createdAt ? dates.relativeDay(inquiry.createdAt) : "Undated"}
            inquiry={inquiry}
            key={inquiry.id}
            onMove={move}
          />
        ))}
      </View>
    </Screen>
  );
}

/**
 * One lead.
 *
 * Anatomy follows NOTES §5's row: an avatar, the name, a meta line, and the
 * actions underneath — with the message given its own paragraph, because it is
 * the one thing on the card somebody has to *read* rather than scan, and the
 * reason a hostel rings back rather than closing it.
 */
function InquiryCard({
  busy,
  date,
  inquiry,
  onMove,
}: {
  busy: boolean;
  date: string;
  inquiry: ManagedInquiry;
  onMove: (inquiry: ManagedInquiry, status: InquiryStatus) => Promise<void>;
}) {
  const actions = inquiryActions(inquiry.status);

  const meta = [
    inquiry.preferredRoomType ? humanizeEnum(inquiry.preferredRoomType) : null,
    inquiry.budgetRange || null,
    date,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-3">
        <Avatar name={inquiry.name} size="md" />

        <View className="flex-1">
          <Text numberOfLines={1} variant="subtitle">
            {inquiry.name || "Someone"}
          </Text>
          <Text numberOfLines={1} variant="caption">
            {meta}
          </Text>
        </View>

        <View className="shrink-0">
          <StatusPill status={inquiry.status} />
        </View>
      </View>

      {inquiry.message ? (
        <Text numberOfLines={4} variant="muted">
          {inquiry.message}
        </Text>
      ) : null}

      {/*
        The phone number is the action, so it is a chip carrying the number
        rather than a button saying "Call" — the same call `wardens.tsx` makes.
        A lead with no number is the one case where ringing back is impossible,
        and drawing a dead Call button for it is the trap §11.6 found on Money.
      */}
      <View className="flex-row flex-wrap gap-2">
        {inquiry.phone ? (
          <Chip
            icon="call-outline"
            label={inquiry.phone}
            onPress={() => void Linking.openURL(`tel:${inquiry.phone}`)}
          />
        ) : null}
        {inquiry.email ? (
          <Chip
            icon="mail-outline"
            label={inquiry.email}
            onPress={() => void Linking.openURL(`mailto:${inquiry.email}`)}
          />
        ) : null}
      </View>

      <View className="flex-row gap-2">
        {actions.map((action, index) => (
          <Button
            className="flex-1"
            disabled={busy}
            key={action.status}
            label={action.label}
            loading={busy && index === 0}
            onPress={() => void onMove(inquiry, action.status)}
            size="sm"
            variant={index === 0 ? "outline" : "ghost"}
          />
        ))}
      </View>
    </Card>
  );
}
