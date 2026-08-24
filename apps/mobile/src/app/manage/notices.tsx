import { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FloatingButton } from "@/components/ui/floating-button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/layout";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { EmptyCard, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import {
  createManagedNotice,
  listManagedNotices,
  type ManagedNotice,
  NOTICE_CATEGORIES,
  type NoticeAudience,
  type NoticeCategory,
  updateManagedNotice,
} from "@/lib/admin-manage-api";
import { readApiError } from "@/lib/api-contract";
import { formatDateTime, humanizeEnum } from "@/lib/format";
import {
  dayInputFromNow,
  endOfDayIso,
  isFuture,
  isPast,
  startOfDayIso,
  toDayInput,
} from "@/lib/manage-dates";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Notices, in full.
 *
 * ## What Today already does, and why this is not that
 *
 * `(admin)/today.tsx` has a compose sheet with two fields and an urgent switch,
 * and its own comment explains the omission: scheduling, expiry and audience are
 * "decisions someone makes at a desk with the calendar open". Half of that was
 * right — they are not what you reach for to say *water is off until 4pm* — and
 * half of it was the browser-handoff argument in disguise. Both screens now
 * exist and they are for different jobs: Today writes one, this manages all of
 * them.
 *
 * ## Live, scheduled and expired are computed, not stored
 *
 * There is no status field on a notice. `publishedAt` in the future means it has
 * not gone out yet; `expiresAt` in the past means it no longer applies. The
 * segments below are those two comparisons and nothing else, which is why a
 * notice can move between them without anybody editing it.
 *
 * ## There is no delete, on purpose
 *
 * The server offers `POST` and `PATCH` and no `DELETE`. A notice residents have
 * already read should stop *applying*, not stop having existed — so "Expire now"
 * writes `expiresAt`, and the record and its read receipts stay put.
 */

type NoticeState = "all" | "live" | "scheduled" | "expired";

function stateOf(notice: ManagedNotice, now: Date): NoticeState {
  if (isFuture(notice.publishedAt, now)) {
    return "scheduled";
  }

  return isPast(notice.expiresAt, now) ? "expired" : "live";
}

const CATEGORY_OPTIONS = NOTICE_CATEGORIES.map((value) => ({
  label: humanizeEnum(value),
  value,
}));

const AUDIENCE_OPTIONS: { description: string; label: string; value: NoticeAudience }[] = [
  {
    description: "Residents and their guardians.",
    label: "Everyone",
    value: "ALL",
  },
  {
    description: "Only the people living here.",
    label: "Residents",
    value: "RESIDENTS",
  },
  {
    /*
     * Worth saying out loud: `deliverNoticeBroadcast` skips the fan-out entirely
     * for this audience. Guardians read notices by opening their dashboard, so a
     * guardians-only notice sends no push and no email — it appears, silently.
     */
    description: "Guardians only. Sends no push — they see it on their dashboard.",
    label: "Guardians",
    value: "GUARDIANS",
  },
];

type Draft = {
  category: NoticeCategory;
  content: string;
  expiresOn: string;
  isUrgent: boolean;
  publishOn: string;
  targetAudience: NoticeAudience;
  title: string;
};

const BLANK_DRAFT: Draft = {
  category: "GENERAL",
  content: "",
  expiresOn: "",
  isUrgent: false,
  publishOn: "",
  targetAudience: "ALL",
  title: "",
};

function draftFrom(notice: ManagedNotice): Draft {
  return {
    category: (notice.category as NoticeCategory) ?? "GENERAL",
    content: notice.content,
    expiresOn: toDayInput(notice.expiresAt),
    isUrgent: notice.isUrgent,
    // A notice already live is not re-scheduled by opening it, so the field
    // shows the date it went out and only a deliberate change moves it.
    publishOn: toDayInput(notice.publishedAt),
    targetAudience: (notice.targetAudience as NoticeAudience) ?? "ALL",
    title: notice.title,
  };
}

export default function ManageNoticesScreen() {
  const [category, setCategory] = useState<string>("");
  const [state, setState] = useState<NoticeState>("all");
  const [editing, setEditing] = useState<ManagedNotice | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT);
  const [saving, setSaving] = useState(false);

  const notices = useResource<ManagedNotice[]>(
    useCallback(() => listManagedNotices({ category }), [category]),
    { topics: [REALTIME_TOPIC.NOTICES] },
  );

  const now = new Date();
  const rows = useMemo(() => notices.data ?? [], [notices.data]);

  const counts = useMemo(() => {
    const tally = { all: rows.length, expired: 0, live: 0, scheduled: 0 };

    for (const notice of rows) {
      tally[stateOf(notice, now)] += 1;
    }

    return tally;
    // `now` is a fresh Date each render by design — the tally is a snapshot, and
    // pinning it in a dep array would make an expiry that passes while the
    // screen is open invisible until a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const visible = useMemo(
    () => (state === "all" ? rows : rows.filter((notice) => stateOf(notice, now) === state)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, state],
  );

  const { reload } = notices;

  const submit = useCallback(async () => {
    const title = draft.title.trim();
    const content = draft.content.trim();

    if (title.length < 2) {
      toastError("Give it a title", "Two characters at least — residents scan these.");
      return;
    }

    if (content.length < 2) {
      toastError("Say what it is", "The body cannot be empty.");
      return;
    }

    if (draft.publishOn && !startOfDayIso(draft.publishOn)) {
      toastError("Check the publish date", "Write it as YYYY-MM-DD.");
      return;
    }

    if (draft.expiresOn && !endOfDayIso(draft.expiresOn)) {
      toastError("Check the expiry date", "Write it as YYYY-MM-DD.");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        category: draft.category,
        content,
        expiresAt: draft.expiresOn ? (endOfDayIso(draft.expiresOn) ?? undefined) : undefined,
        isUrgent: draft.isUrgent,
        publishedAt: draft.publishOn ? (startOfDayIso(draft.publishOn) ?? undefined) : undefined,
        targetAudience: draft.targetAudience,
        title,
      };

      if (editing) {
        await updateManagedNotice(editing.id, payload);
        toastSuccess("Notice updated");
      } else {
        await createManagedNotice(payload);
        toastSuccess(
          isFuture(payload.publishedAt, new Date()) ? "Notice scheduled" : "Notice published",
          draft.targetAudience === "GUARDIANS"
            ? "Guardians will see it on their dashboard."
            : "Residents have been notified.",
        );
      }

      setComposing(false);
      setEditing(null);
      await reload();
    } catch (error) {
      toastError("Could not save", readApiError(error, "The notice did not save."));
    } finally {
      setSaving(false);
    }
  }, [draft, editing, reload]);

  const expireNow = useCallback(
    async (notice: ManagedNotice) => {
      setSaving(true);

      try {
        // Yesterday rather than this instant: `expiresAt` is compared against
        // "now" on every read, and a value a second old is indistinguishable
        // from one that has not landed yet on a phone with a drifting clock.
        await updateManagedNotice(notice.id, {
          expiresAt: endOfDayIso(dayInputFromNow(-1)) ?? undefined,
        });
        toastSuccess("Expired", "It no longer shows on anyone's notice board.");
        setEditing(null);
        await reload();
      } catch (error) {
        toastError("Could not expire", readApiError(error));
      } finally {
        setSaving(false);
      }
    },
    [reload],
  );

  const open = useCallback((notice: ManagedNotice) => {
    setDraft(draftFrom(notice));
    setEditing(notice);
  }, []);

  const compose = useCallback(() => {
    setDraft(BLANK_DRAFT);
    setEditing(null);
    setComposing(true);
  }, []);

  return (
    <Screen
      floating={<FloatingButton icon="create-outline" label="Write a notice" onPress={compose} />}
      header={<AppBar accent centerTitle showBack title="Notices" />}
      onRefresh={notices.refresh}
      refreshing={notices.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <Segmented
          onChange={setState}
          options={[
            { count: counts.all, label: "All", value: "all" },
            { count: counts.live, label: "Live", value: "live" },
            { count: counts.scheduled, label: "Scheduled", value: "scheduled" },
            { count: counts.expired, label: "Expired", value: "expired" },
          ]}
          value={state}
        />

        {/*
          Category filters the *request*, unlike the segments above it, because
          the server takes `?category=` and the list is capped at fifty rows —
          filtering client-side would quietly hide older notices in a busy
          category.
        */}
        <ScrollView
          contentContainerClassName="gap-2 pr-4"
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          <Chip
            label="Every category"
            onPress={() => setCategory("")}
            tone={category === "" ? "brand" : "neutral"}
          />
          {NOTICE_CATEGORIES.map((value) => (
            <Chip
              key={value}
              label={humanizeEnum(value)}
              onPress={() => setCategory(value)}
              tone={category === value ? "brand" : "neutral"}
            />
          ))}
        </ScrollView>

        {notices.loading ? <LoadingState label="Reading the notice board" /> : null}

        {notices.error ? (
          <ErrorState message={notices.error} onRetry={notices.reload} />
        ) : null}

        {!notices.loading && !notices.error && visible.length === 0 ? (
          <EmptyCard
            description={
              state === "all"
                ? "Nothing has been posted here yet."
                : `No ${state} notices${category ? ` in ${humanizeEnum(category)}` : ""}.`
            }
            title="Nothing to show"
          />
        ) : null}

        {visible.map((notice) => {
          const current = stateOf(notice, now);

          return (
            <Card className="gap-2" key={notice.id}>
              <View className="flex-row items-start gap-2">
                <Text className="flex-1" variant="subtitle">
                  {notice.title}
                </Text>
                <Badge
                  label={
                    current === "live" ? "Live" : current === "scheduled" ? "Scheduled" : "Expired"
                  }
                  tone={
                    current === "live" ? "success" : current === "scheduled" ? "info" : "neutral"
                  }
                />
              </View>

              <Text numberOfLines={3} variant="muted">
                {notice.content}
              </Text>

              <View className="flex-row flex-wrap gap-2">
                <Chip icon="pricetag-outline" label={humanizeEnum(notice.category)} />
                <Chip
                  icon="people-outline"
                  label={
                    notice.targetAudience === "ALL"
                      ? "Everyone"
                      : humanizeEnum(notice.targetAudience)
                  }
                />
                {notice.isUrgent ? (
                  <Chip icon="alert-circle-outline" label="Urgent" tone="brand" />
                ) : null}
              </View>

              <Text variant="caption">
                {current === "scheduled"
                  ? `Goes out ${formatDateTime(notice.publishedAt)}`
                  : `Posted ${formatDateTime(notice.publishedAt ?? notice.createdAt)}`}
                {notice.expiresAt
                  ? ` · ${current === "expired" ? "Expired" : "Expires"} ${formatDateTime(notice.expiresAt)}`
                  : " · No expiry"}
              </Text>

              <View className="flex-row gap-2 pt-1">
                <Button
                  className="flex-1"
                  label="Edit"
                  onPress={() => open(notice)}
                  size="sm"
                  variant="outline"
                />
                {current !== "expired" ? (
                  <Button
                    className="flex-1"
                    label="Expire now"
                    onPress={() => void expireNow(notice)}
                    size="sm"
                    variant="ghost"
                  />
                ) : null}
              </View>
            </Card>
          );
        })}
      </View>

      <Sheet
        footer={
          <Button
            label={editing ? "Save changes" : "Publish"}
            loading={saving}
            onPress={() => void submit()}
          />
        }
        onClose={() => {
          setComposing(false);
          setEditing(null);
        }}
        open={composing || editing !== null}
        title={editing ? "Edit notice" : "New notice"}
      >
        <View className="gap-3 pb-2">
          <Input
            label="Title"
            onChangeText={(title) => setDraft((prev) => ({ ...prev, title }))}
            placeholder="Water supply interrupted"
            value={draft.title}
          />

          <Input
            label="Notice"
            multiline
            onChangeText={(content) => setDraft((prev) => ({ ...prev, content }))}
            placeholder="What is happening, and what should people do about it."
            style={{ height: 132 }}
            value={draft.content}
          />

          <Select
            label="Category"
            onChange={(value) => setDraft((prev) => ({ ...prev, category: value }))}
            options={CATEGORY_OPTIONS}
            value={draft.category}
          />

          <Select
            label="Who sees it"
            onChange={(value) => setDraft((prev) => ({ ...prev, targetAudience: value }))}
            options={AUDIENCE_OPTIONS}
            value={draft.targetAudience}
          />

          <View className="flex-row items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
            <View className="flex-1">
              <Text variant="label">Mark urgent</Text>
              <Text variant="caption">
                Pins it to the top of the notice board and colours it red.
              </Text>
            </View>
            <Toggle
              accessibilityLabel="Mark this notice urgent"
              onChange={(isUrgent) => setDraft((prev) => ({ ...prev, isUrgent }))}
              value={draft.isUrgent}
            />
          </View>

          <View className="gap-2">
            <Input
              hint="Leave blank to publish immediately."
              keyboardType="numbers-and-punctuation"
              label="Publish on"
              onChangeText={(publishOn) => setDraft((prev) => ({ ...prev, publishOn }))}
              placeholder="YYYY-MM-DD"
              value={draft.publishOn}
            />
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Now" onPress={() => setDraft((prev) => ({ ...prev, publishOn: "" }))} />
              <Chip
                label="Tomorrow"
                onPress={() => setDraft((prev) => ({ ...prev, publishOn: dayInputFromNow(1) }))}
              />
              <Chip
                label="In a week"
                onPress={() => setDraft((prev) => ({ ...prev, publishOn: dayInputFromNow(7) }))}
              />
            </View>
          </View>

          <View className="gap-2">
            <Input
              hint="The last day it applies. Leave blank and it stays up until you expire it."
              keyboardType="numbers-and-punctuation"
              label="Expires on"
              onChangeText={(expiresOn) => setDraft((prev) => ({ ...prev, expiresOn }))}
              placeholder="YYYY-MM-DD"
              value={draft.expiresOn}
            />
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Never" onPress={() => setDraft((prev) => ({ ...prev, expiresOn: "" }))} />
              <Chip
                label="In 3 days"
                onPress={() => setDraft((prev) => ({ ...prev, expiresOn: dayInputFromNow(3) }))}
              />
              <Chip
                label="In a week"
                onPress={() => setDraft((prev) => ({ ...prev, expiresOn: dayInputFromNow(7) }))}
              />
              <Chip
                label="In a month"
                onPress={() => setDraft((prev) => ({ ...prev, expiresOn: dayInputFromNow(30) }))}
              />
            </View>
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}
