import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { Linking, ScrollView, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { FloatingButton } from "@/components/ui/floating-button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/layout";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { EmptyCard, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import {
  commentOnMaintenance,
  createMaintenanceRequest,
  listManagedMaintenance,
  listManagedProviders,
  MAINTENANCE_CATEGORIES,
  type MaintenanceCategory,
  type MaintenancePriority,
  type MaintenanceStatus,
  type ManagedMaintenance,
  type ManagedMaintenanceRequest,
  type ManagedProvider,
  updateMaintenanceStatus,
} from "@/lib/admin-manage-api";
import { readApiError } from "@/lib/api-contract";
import { formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import {
  categoryForRole,
  providerRoleLabel,
  suggestPriority,
  suggestProviderRoles,
  titleFromProblem,
} from "@/lib/maintenance-suggest";
import { dayInputFromNow, startOfDayIso, toDayInput } from "@/lib/manage-dates";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Maintenance — the queue, plus the directory of people who fix things.
 *
 * ## Raising a request is one sentence, not a form
 *
 * The web asks for a title, a category, a priority, a location and a provider.
 * Four of those five can be read out of the sentence somebody would type anyway
 * — "tap in room 204 is leaking, urgent" gives the title, the category, the
 * priority and the role to call — so the sheet leads with the problem text and
 * fills the rest in, visibly, as suggestions the admin can override. The
 * scoring is `lib/maintenance-suggest.ts`, a copy of the web's own rules.
 *
 * ## The provider is chosen once, at creation
 *
 * `maintenanceStatusUpdateSchema` has no `providerId`, so there is no reassign
 * route to build a screen for: a request that went to the wrong person is
 * cancelled with a note and raised again. Worth knowing before looking for the
 * button that is not here.
 *
 * ## The list already carries the thread
 *
 * `GET .../requests` returns each request with its `comments` and `history`
 * inline, so opening one costs nothing and there is no detail fetch. Do not add
 * one.
 *
 * ## Internal notes are internal
 *
 * A comment's `visibility` is `INTERNAL` or `PROVIDER_NOTE`, and the sheet makes
 * you pick. That distinction is invisible on the phone otherwise, and "the cost
 * seems high, get a second quote" reaching the plumber it is about is the exact
 * failure the flag exists to prevent.
 */

type Filter = "all" | "open" | "scheduled" | "done";

const FILTER_STATUSES: Record<Filter, readonly string[]> = {
  all: [],
  done: ["COMPLETED", "CANCELLED"],
  open: ["PENDING", "CONTACTED"],
  scheduled: ["SCHEDULED"],
};

const PRIORITY_OPTIONS: { description: string; label: string; value: MaintenancePriority }[] = [
  { description: "Whenever somebody is passing.", label: "Low", value: "LOW" },
  { description: "The normal case.", label: "Medium", value: "MEDIUM" },
  { description: "This week, and it is annoying people.", label: "High", value: "HIGH" },
  { description: "Today. Somebody could be hurt.", label: "Urgent", value: "URGENT" },
];

const CATEGORY_OPTIONS = MAINTENANCE_CATEGORIES.map((value) => ({
  label: humanizeEnum(value),
  value,
}));

const STATUS_OPTIONS: { description: string; label: string; value: MaintenanceStatus }[] = [
  { description: "Nobody has been called yet.", label: "Pending", value: "PENDING" },
  { description: "You have spoken to somebody.", label: "Contacted", value: "CONTACTED" },
  { description: "They are coming on a known day.", label: "Scheduled", value: "SCHEDULED" },
  { description: "Fixed, and you have seen it.", label: "Completed", value: "COMPLETED" },
  { description: "Not going ahead.", label: "Cancelled", value: "CANCELLED" },
];

const PRIORITY_TONE: Record<string, "danger" | "info" | "neutral" | "warning"> = {
  HIGH: "warning",
  LOW: "neutral",
  MEDIUM: "info",
  URGENT: "danger",
};

type NewDraft = {
  category: MaintenanceCategory | null;
  location: string;
  priority: MaintenancePriority | null;
  problem: string;
  providerId: string;
};

const BLANK_NEW: NewDraft = {
  category: null,
  location: "",
  priority: null,
  problem: "",
  providerId: "",
};

type MaintenanceData = {
  maintenance: ManagedMaintenance | null;
  providers: ManagedProvider[];
};

async function loadMaintenance(status: string): Promise<MaintenanceData> {
  const [maintenance, providers] = await Promise.all([
    listManagedMaintenance(status ? { status } : {}).catch(() => null),
    listManagedProviders().catch(() => [] as ManagedProvider[]),
  ]);

  return { maintenance, providers };
}

export default function ManageMaintenanceScreen() {
  const { colors } = useAppTheme();
  const [filter, setFilter] = useState<Filter>("all");
  const [raising, setRaising] = useState(false);
  const [draft, setDraft] = useState<NewDraft>(BLANK_NEW);
  const [open, setOpen] = useState<ManagedMaintenanceRequest | null>(null);
  const [statusDraft, setStatusDraft] = useState<MaintenanceStatus>("CONTACTED");
  const [statusNote, setStatusNote] = useState("");
  const [costNote, setCostNote] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const [comment, setComment] = useState("");
  const [commentInternal, setCommentInternal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [providersOpen, setProvidersOpen] = useState(false);

  /*
   * The request goes out unfiltered and the segments cut the result locally.
   * `?status=` takes one value, the segments group two apiece, and the route's
   * own `summary` counts what it returned — asking the server for PENDING would
   * make the summary say "all of them are pending", which is the trap
   * `admin-api.ts` already documents for Today's copy of this call.
   */
  const data = useResource<MaintenanceData>(
    useCallback(() => loadMaintenance(""), []),
    { topics: [REALTIME_TOPIC.MAINTENANCE] },
  );

  const requests = useMemo(
    () => data.data?.maintenance?.requests ?? [],
    [data.data],
  );
  const providers = useMemo(() => data.data?.providers ?? [], [data.data]);

  const counts = useMemo(
    () => ({
      all: requests.length,
      done: requests.filter((request) => FILTER_STATUSES.done.includes(request.status)).length,
      open: requests.filter((request) => FILTER_STATUSES.open.includes(request.status)).length,
      scheduled: requests.filter((request) => request.status === "SCHEDULED").length,
    }),
    [requests],
  );

  const visible = useMemo(
    () =>
      filter === "all"
        ? requests
        : requests.filter((request) => FILTER_STATUSES[filter].includes(request.status)),
    [filter, requests],
  );

  const suggestions = useMemo(() => suggestProviderRoles(draft.problem), [draft.problem]);
  const suggestedCategory = draft.category ?? (suggestions[0] ? suggestions[0].category : null);
  const suggestedPriority = draft.priority ?? (draft.problem ? suggestPriority(draft.problem) : null);

  /** Providers whose trade matches the category the request is heading for. */
  const matchingProviders = useMemo(() => {
    if (!suggestedCategory) {
      return providers;
    }

    return providers.filter(
      (provider) =>
        categoryForRole(provider.category) === suggestedCategory ||
        provider.categories.some((role) => categoryForRole(role) === suggestedCategory),
    );
  }, [providers, suggestedCategory]);

  const { reload } = data;

  const raise = useCallback(async () => {
    const problem = draft.problem.trim();

    if (problem.length < 2) {
      toastError("Describe the problem", "One sentence is enough.");
      return;
    }

    setBusy(true);

    try {
      await createMaintenanceRequest({
        category: suggestedCategory ?? "OTHER",
        description: problem,
        location: draft.location.trim() || undefined,
        priority: suggestedPriority ?? "MEDIUM",
        providerId: draft.providerId || undefined,
        title: titleFromProblem(problem),
      });

      toastSuccess("Request raised", "It is in the queue and on the Today tab.");
      setRaising(false);
      setDraft(BLANK_NEW);
      await reload();
    } catch (error) {
      toastError("Could not raise it", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [draft, reload, suggestedCategory, suggestedPriority]);

  const applyStatus = useCallback(async () => {
    if (!open) {
      return;
    }

    if (statusDraft === "SCHEDULED" && scheduledOn && !startOfDayIso(scheduledOn)) {
      toastError("Check the date", "Write it as YYYY-MM-DD.");
      return;
    }

    setBusy(true);

    try {
      await updateMaintenanceStatus(open.id, {
        costNote: costNote.trim() || undefined,
        note: statusNote.trim() || undefined,
        scheduledFor:
          statusDraft === "SCHEDULED" && scheduledOn
            ? (startOfDayIso(scheduledOn) ?? undefined)
            : undefined,
        status: statusDraft,
      });

      toastSuccess(`Marked ${humanizeEnum(statusDraft).toLowerCase()}`);
      setOpen(null);
      setStatusNote("");
      setCostNote("");
      setScheduledOn("");
      await reload();
    } catch (error) {
      toastError("Could not update", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [costNote, open, reload, scheduledOn, statusDraft, statusNote]);

  const addComment = useCallback(async () => {
    if (!open || comment.trim().length === 0) {
      return;
    }

    setBusy(true);

    try {
      await commentOnMaintenance(open.id, {
        message: comment.trim(),
        visibility: commentInternal ? "INTERNAL" : "PROVIDER_NOTE",
      });
      setComment("");
      toastSuccess(commentInternal ? "Note added" : "Note left for the provider");
      await reload();
    } catch (error) {
      toastError("Could not add that", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [comment, commentInternal, open, reload]);

  const openRequest = useCallback((request: ManagedMaintenanceRequest) => {
    setOpen(request);
    // Pre-set to the next sensible step rather than to what it already is —
    // nobody opens this sheet to mark a pending request pending.
    setStatusDraft(
      request.status === "PENDING"
        ? "CONTACTED"
        : request.status === "CONTACTED"
          ? "SCHEDULED"
          : "COMPLETED",
    );
    setScheduledOn(toDayInput(request.scheduledFor) || dayInputFromNow(1));
    setStatusNote("");
    setCostNote(request.costNote ?? "");
  }, []);

  const providerFor = useCallback(
    (providerId?: string) => providers.find((provider) => provider.id === providerId) ?? null,
    [providers],
  );

  return (
    <Screen
      floating={
        <FloatingButton
          icon="build-outline"
          label="Raise a request"
          onPress={() => {
            setDraft(BLANK_NEW);
            setRaising(true);
          }}
        />
      }
      header={
        <AppBar
          accent
          actions={
            <Button
              label="Providers"
              onPress={() => setProvidersOpen(true)}
              size="sm"
              variant="ghost"
            />
          }
          centerTitle
          showBack
          title="Maintenance"
        />
      }
      onRefresh={data.refresh}
      refreshing={data.refreshing}
      scroll
    >
      <View className="gap-4 pt-1">
        <Segmented
          onChange={setFilter}
          options={[
            { count: counts.all, label: "All", value: "all" },
            { count: counts.open, label: "Open", value: "open" },
            { count: counts.scheduled, label: "Booked", value: "scheduled" },
            { count: counts.done, label: "Closed", value: "done" },
          ]}
          value={filter}
        />

        {data.loading ? <LoadingState label="Reading the repair queue" /> : null}

        {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : null}

        {!data.loading && !data.error && visible.length === 0 ? (
          <EmptyCard
            description={
              filter === "all"
                ? "Nothing has been reported. Raise one yourself with the button below."
                : "Nothing in this state right now."
            }
            title="No requests"
          />
        ) : null}

        {visible.map((request) => {
          const provider = providerFor(request.providerId);

          return (
            <Card className="gap-2" key={request.id}>
              <View className="flex-row items-start gap-2">
                <Text className="flex-1" variant="subtitle">
                  {request.title}
                </Text>
                <StatusPill status={request.status} />
              </View>

              {request.description && request.description !== request.title ? (
                <Text numberOfLines={2} variant="muted">
                  {request.description}
                </Text>
              ) : null}

              <View className="flex-row flex-wrap gap-2">
                <Badge
                  label={humanizeEnum(request.priority)}
                  tone={PRIORITY_TONE[request.priority] ?? "neutral"}
                />
                <Chip icon="construct-outline" label={humanizeEnum(request.category)} />
                {request.location ? (
                  <Chip icon="location-outline" label={request.location} />
                ) : null}
                {request.comments.length > 0 ? (
                  <Chip
                    icon="chatbubble-ellipses-outline"
                    label={`${request.comments.length} note(s)`}
                  />
                ) : null}
              </View>

              {provider ? (
                <View className="flex-row flex-wrap gap-2">
                  <Chip icon="person-outline" label={provider.fullName} />
                  {provider.phone ? (
                    <Chip
                      icon="call-outline"
                      label={provider.phone}
                      onPress={() => void Linking.openURL(`tel:${provider.phone}`)}
                      tone="brand"
                    />
                  ) : null}
                </View>
              ) : null}

              <Text variant="caption">
                Raised {formatDate(request.createdAt)}
                {request.scheduledFor ? ` · Booked for ${formatDate(request.scheduledFor)}` : ""}
                {request.completedAt ? ` · Done ${formatDate(request.completedAt)}` : ""}
              </Text>

              <Button
                label="Open"
                onPress={() => openRequest(request)}
                size="sm"
                variant="outline"
              />
            </Card>
          );
        })}
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Raise                                                              */}
      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={<Button label="Raise it" loading={busy} onPress={() => void raise()} />}
        onClose={() => setRaising(false)}
        open={raising}
        title="What needs fixing?"
      >
        <View className="gap-3 pb-2">
          <Input
            hint="Plain language. We read it and fill in the rest."
            label="The problem"
            multiline
            onChangeText={(problem) => setDraft((prev) => ({ ...prev, problem }))}
            placeholder="The tap in room 204 has been leaking since Tuesday"
            style={{ height: 96 }}
            value={draft.problem}
          />

          {suggestions.length > 0 ? (
            <View className="gap-2 rounded-xl border border-primary/30 bg-brand-soft p-3">
              <View className="flex-row items-center gap-2">
                <Ionicons color={colors.primary} name="sparkles-outline" size={14} />
                <Text className="text-primary" variant="label">
                  Sounds like a job for
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <Chip
                    key={suggestion.role}
                    label={providerRoleLabel(suggestion.role)}
                    onPress={() =>
                      setDraft((prev) => ({ ...prev, category: suggestion.category }))
                    }
                    tone={suggestedCategory === suggestion.category ? "brand" : "neutral"}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <Select
            hint="Read from what you typed. Change it if we guessed wrong."
            label="Category"
            onChange={(category) => setDraft((prev) => ({ ...prev, category }))}
            options={CATEGORY_OPTIONS}
            placeholder="Pick one"
            value={suggestedCategory}
          />

          <Select
            hint="Urgency words in the problem text move this on their own."
            label="Priority"
            onChange={(priority) => setDraft((prev) => ({ ...prev, priority }))}
            options={PRIORITY_OPTIONS}
            placeholder="Pick one"
            value={suggestedPriority}
          />

          <Input
            hint="Free text — there are no room records to pick from."
            label="Where"
            onChangeText={(location) => setDraft((prev) => ({ ...prev, location }))}
            placeholder="Room 204"
            value={draft.location}
          />

          <View className="gap-2">
            <Text variant="label">Assign a provider</Text>
            <Text variant="caption">
              Optional, and it cannot be changed later — the server has no reassign
              route, so a request sent to the wrong person is cancelled and raised
              again.
            </Text>
            {matchingProviders.length === 0 ? (
              <Text variant="muted">
                No approved provider matches this trade yet. Raise it unassigned and
                call somebody yourself.
              </Text>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                <Chip
                  label="Nobody yet"
                  onPress={() => setDraft((prev) => ({ ...prev, providerId: "" }))}
                  tone={draft.providerId === "" ? "brand" : "neutral"}
                />
                {matchingProviders.map((provider) => (
                  <Chip
                    key={provider.id}
                    label={`${provider.fullName} · ${provider.area}`}
                    onPress={() =>
                      setDraft((prev) => ({ ...prev, providerId: provider.id }))
                    }
                    tone={draft.providerId === provider.id ? "brand" : "neutral"}
                  />
                ))}
              </View>
            )}
          </View>
        </View>
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      {/* One request                                                        */}
      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          <Button label="Apply status" loading={busy} onPress={() => void applyStatus()} />
        }
        onClose={() => setOpen(null)}
        open={open !== null}
        title={open?.title ?? ""}
      >
        {open ? (
          <View className="gap-4 pb-2">
            <View className="gap-2">
              <View className="flex-row flex-wrap gap-2">
                <StatusPill status={open.status} />
                <Badge
                  label={humanizeEnum(open.priority)}
                  tone={PRIORITY_TONE[open.priority] ?? "neutral"}
                />
                <Chip icon="construct-outline" label={humanizeEnum(open.category)} />
              </View>
              {open.description ? <Text variant="muted">{open.description}</Text> : null}
              {open.costNote ? (
                <Text variant="caption">{`Cost note: ${open.costNote}`}</Text>
              ) : null}
            </View>

            <View className="gap-2 border-t border-border pt-3">
              <Text variant="label">Move it on</Text>
              <Select
                label="Status"
                onChange={setStatusDraft}
                options={STATUS_OPTIONS}
                value={statusDraft}
              />

              {statusDraft === "SCHEDULED" ? (
                <>
                  <Input
                    keyboardType="numbers-and-punctuation"
                    label="Coming on"
                    onChangeText={setScheduledOn}
                    placeholder="YYYY-MM-DD"
                    value={scheduledOn}
                  />
                  <View className="flex-row flex-wrap gap-2">
                    <Chip label="Today" onPress={() => setScheduledOn(dayInputFromNow(0))} />
                    <Chip
                      label="Tomorrow"
                      onPress={() => setScheduledOn(dayInputFromNow(1))}
                    />
                    <Chip
                      label="In 3 days"
                      onPress={() => setScheduledOn(dayInputFromNow(3))}
                    />
                  </View>
                </>
              ) : null}

              <Input
                hint="Kept on the history entry, so “why was this cancelled” has an answer."
                label="Note"
                onChangeText={setStatusNote}
                placeholder="Plumber came, part on order"
                value={statusNote}
              />

              <Input
                keyboardType="numbers-and-punctuation"
                label="Cost note"
                onChangeText={setCostNote}
                placeholder="NPR 1,200 including the part"
                value={costNote}
              />
            </View>

            <View className="gap-2 border-t border-border pt-3">
              <SectionHeader
                subtitle={`${open.comments.length} note(s), ${open.history.length} change(s)`}
                title="Thread"
              />

              {open.comments.map((entry) => (
                <View className="gap-1 rounded-xl border border-border p-3" key={entry.id}>
                  <View className="flex-row items-center justify-between gap-2">
                    <Badge
                      label={entry.visibility === "INTERNAL" ? "Internal" : "For the provider"}
                      tone={entry.visibility === "INTERNAL" ? "neutral" : "info"}
                    />
                    <Text variant="caption">{formatDateTime(entry.createdAt)}</Text>
                  </View>
                  <Text>{entry.message}</Text>
                </View>
              ))}

              {open.history.map((entry) => (
                <Text key={entry.id} variant="caption">
                  {`${formatDateTime(entry.createdAt)} — ${humanizeEnum(entry.previousStatus)} → ${humanizeEnum(entry.nextStatus)}${entry.note ? `: ${entry.note}` : ""}`}
                </Text>
              ))}

              <Input
                label="Add a note"
                multiline
                onChangeText={setComment}
                placeholder="What happened"
                style={{ height: 72 }}
                value={comment}
              />

              <View className="flex-row flex-wrap gap-2">
                <Chip
                  icon="lock-closed-outline"
                  label="Internal"
                  onPress={() => setCommentInternal(true)}
                  tone={commentInternal ? "brand" : "neutral"}
                />
                <Chip
                  icon="share-outline"
                  label="For the provider"
                  onPress={() => setCommentInternal(false)}
                  tone={commentInternal ? "neutral" : "brand"}
                />
              </View>

              <Button
                disabled={comment.trim().length === 0}
                label="Add the note"
                loading={busy}
                onPress={() => void addComment()}
                size="sm"
                variant="outline"
              />
            </View>
          </View>
        ) : null}
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      {/* Providers                                                          */}
      {/* ------------------------------------------------------------------ */}
      <Sheet
        onClose={() => setProvidersOpen(false)}
        open={providersOpen}
        title="Approved providers"
      >
        <View className="gap-3 pb-2">
          <Text variant="caption">
            Vetted by the platform, and their phone numbers are visible to hostel
            staff only — the public directory hides them so nobody is cold-called.
          </Text>

          {providers.length === 0 ? (
            <Text variant="muted">No approved providers cover your area yet.</Text>
          ) : (
            providers.map((provider) => (
              <View className="gap-2 rounded-xl border border-border p-3" key={provider.id}>
                <View className="flex-row items-start justify-between gap-2">
                  <View className="flex-1">
                    <Text variant="label">{provider.fullName}</Text>
                    <Text variant="caption">
                      {`${providerRoleLabel(provider.category)} · ${provider.area}, ${provider.city}`}
                    </Text>
                  </View>
                  {provider.ratingSummary.totalReviews > 0 ? (
                    <Badge
                      label={`${provider.ratingSummary.averageRating.toFixed(1)} ★`}
                      tone="success"
                    />
                  ) : null}
                </View>

                {provider.availability ? (
                  <Text variant="caption">{provider.availability}</Text>
                ) : null}

                <ScrollView
                  contentContainerClassName="gap-2"
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  {provider.phone ? (
                    <Chip
                      icon="call-outline"
                      label={provider.phone}
                      onPress={() => void Linking.openURL(`tel:${provider.phone}`)}
                      tone="brand"
                    />
                  ) : null}
                  {provider.categories.map((role) => (
                    <Chip key={role} label={providerRoleLabel(role)} />
                  ))}
                </ScrollView>
              </View>
            ))
          )}
        </View>
      </Sheet>
    </Screen>
  );
}
