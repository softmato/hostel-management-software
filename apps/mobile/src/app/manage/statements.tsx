import { Ionicons } from "@expo/vector-icons";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Grid, StatTile } from "@/components/ui/layout";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Sheet, SheetRow } from "@/components/ui/sheet";
import { SkeletonCard } from "@/components/ui/skeleton";
import { EmptyCard, ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  approveMatchedStatement,
  assignOrphanPayment,
  getReconciliation,
  importStatement,
  type ReconciliationView,
  type StatementImport,
  type StatementProvider,
} from "@/lib/admin-manage-api";
import { adminQuery } from "@/lib/admin-queries";
import { readApiError } from "@/lib/api-contract";
import { humanizeEnum } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { uploadAsset } from "@/lib/uploads";

/**
 * "Did the money actually reach my account?" — the whole screen in one question.
 *
 * ## Why this is not optional bookkeeping
 *
 * Payee matching on a payment screenshot is best-effort: a crop, an unfamiliar
 * template or a competent forgery defeats it. So the guarantee the product
 * actually makes is narrower and stronger — **either the money appears in the
 * hostel's own account, or the claim appears in the "not in your account"
 * bucket below.** That bucket is where fraud surfaces, about a week late, and it
 * names the approving warden as well as the resident, because an approval made
 * on trust and never honoured is a fact about two people.
 *
 * ## An import settles money
 *
 * It runs every credit through the matching ladder and auto-settles the rows
 * whose reference codes verify. That is why the route wants `approvePayments`
 * rather than `viewPayments`, and why the file is uploaded as a `STATEMENT`
 * asset — a financial asset, scoped to this hostel on the server.
 *
 * ## The buckets are recomputed on every read
 *
 * Deliberately, rather than frozen at import time: a claim submitted *after* the
 * file was read is not evidence of anything, and a frozen list would keep
 * accusing a resident whose payment has since been verified some other way.
 *
 * ## Who reads this
 *
 * A hostel owner, not an accountant. Every label here is the plain-language name
 * for a bucket the server calls something else — `matched` is "tied to bills",
 * `orphans` is "needs your action", `approvedNotInStatement` is "not in your
 * account". The mapping lives in {@link BUCKETS} and nowhere else, so the
 * server's vocabulary stops at this file's edge.
 */

type Bucket = "tied" | "action" | "missing" | "norecord";

/** Which credits inside "needs your action" are on screen. */
type Guess = "all" | "guessed" | "unknown";

type Buckets = ReconciliationView["buckets"];
type OrphanRow = Buckets["orphans"][number];
type Suggestion = OrphanRow["suggestions"][number];

const PROVIDER_OPTIONS = [
  { description: "A wallet transaction export.", label: "eSewa", value: "ESEWA" },
  { description: "A wallet transaction export.", label: "Khalti", value: "KHALTI" },
  { description: "A bank account statement.", label: "Bank", value: "BANK" },
] as const;

/**
 * The provider's own spelling, not `humanizeEnum`'s.
 *
 * `humanizeEnum("ESEWA")` is "Esewa", and eSewa is a brand our users see a
 * dozen times a day written the other way. Getting it wrong on a screen about
 * their money is the kind of small wrongness that costs trust.
 */
const PROVIDER_LABEL: Record<string, string> = {
  BANK: "Bank",
  ESEWA: "eSewa",
  KHALTI: "Khalti",
};

/**
 * The lettermark each provider is known by — eSewa's `e`, Khalti's `K`.
 *
 * A brand's actual logo would be better and there is nowhere in this repo to
 * take one from: `assets/images` has none, and no other screen renders one
 * either — `invoice/[id]/pay` names its wallets in words. A letter in the
 * hostel's own green is the honest middle: it identifies the row at a glance
 * the way a logo would, without copying a wordmark's colour, which is the one
 * thing `CLAUDE.md` says never to take from a reference.
 */
const PROVIDER_MARK: Record<string, string> = {
  BANK: "B",
  ESEWA: "e",
  KHALTI: "K",
};

function providerLabel(provider: string) {
  return PROVIDER_LABEL[provider] ?? humanizeEnum(provider);
}

/**
 * What each bucket is called, and the one sentence that says why it exists.
 *
 * Held together in one table because the four are only meaningful against each
 * other: every rupee in the file is in exactly one of them, and an owner who
 * reads all four sentences has understood reconciliation without ever meeting
 * the word.
 */
const BUCKETS: Record<
  Bucket,
  {
    empty: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    lead: string;
    surface: string;
    tone: "brand" | "danger" | "neutral" | "warning";
    why: string;
  }
> = {
  action: {
    empty: "Every payment in this file found its resident.",
    icon: "help-circle-outline",
    label: "Needs your action",
    lead: "Payments arrived without a name.",
    surface: "border-warning/30 bg-warning-soft",
    tone: "warning",
    why: "We guessed who each one might be. Check and assign it to the right resident.",
  },
  missing: {
    empty: "Every approved payment reached your account.",
    icon: "alert-circle-outline",
    label: "Not in your account",
    lead: "Approved, but the money never arrived.",
    surface: "border-destructive/30 bg-destructive-soft",
    tone: "danger",
    why: "Your staff marked these as paid. No bank or wallet file has ever carried them.",
  },
  norecord: {
    empty: "Nothing unaccounted for.",
    icon: "time-outline",
    label: "No record yet",
    lead: "A resident says they paid.",
    surface: "border-border bg-muted",
    tone: "neutral",
    why: "Nothing anywhere confirms it yet — not this file, not your own records.",
  },
  tied: {
    empty: "Nothing in this file could be tied to a bill.",
    icon: "shield-checkmark-outline",
    label: "Tied to bills",
    lead: "These payments reached your account.",
    surface: "border-brand/30 bg-brand-soft",
    tone: "brand",
    why: "We could connect each one to a resident's bill. Review and record them in one tap.",
  },
};

const BUCKET_ORDER: Bucket[] = ["tied", "action", "missing", "norecord"];

/** What the picker hands back. Only the four fields the upload needs. */
type PickedFile = { mimeType?: string; name: string; size?: number; uri: string };

type DocumentPickerModule = {
  getDocumentAsync: (options: {
    type?: string[];
  }) => Promise<{ assets: PickedFile[] | null; canceled: boolean }>;
};

/**
 * `expo-document-picker`, loaded only when somebody actually picks a file.
 *
 * ## Why this is not a plain import
 *
 * It is a **native** module, and this project is bare — `android/` is checked in
 * — so it only exists in a binary built after it was added to `package.json`. A
 * top-level `import` of it throws at module load on any older dev client, and
 * expo-router turns that into "Route is missing the required default export":
 * the whole screen dies, including the reconciliation work that needs no native
 * code at all.
 *
 * Requiring it inside the handler moves the failure to the one button that
 * cannot work, and {@link pickerAvailable} lets the screen say so in advance
 * rather than after a tap. Once the app is rebuilt this resolves and nothing
 * else changes.
 *
 * `require` rather than `await import()` on purpose: a dynamic import is a
 * promise Metro still resolves eagerly at bundle time, and the point here is to
 * survive the module being absent from the *binary*, not from the bundle.
 */
function loadDocumentPicker(): DocumentPickerModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-document-picker") as DocumentPickerModule;
  } catch {
    return null;
  }
}

/** Whether this build can open the system file browser at all. */
function pickerAvailable() {
  return loadDocumentPicker() !== null;
}

/**
 * Reads a parse failure and, where it can, turns it into a fix.
 *
 * Three of every four imports on a real hostel's account fail, and nearly all of
 * them fail the same way: the file is fine, the dropdown was wrong. The server
 * already says so — *"This file looks like an eSewa statement"* — so the only
 * thing missing was a screen willing to act on its own error message.
 */
function readFailure(detail: string | null): {
  label: string;
  suggested: StatementProvider | null;
} {
  const wrongType = /does not look like/i.test(detail ?? "");
  const named = /looks like an?\s+(esewa|khalti|bank)/i.exec(detail ?? "");
  const suggested = named
    ? (named[1].toUpperCase() as StatementProvider)
    : null;

  return { label: wrongType ? "Wrong type" : "Failed", suggested };
}

export default function ManageStatementsScreen() {
  const dates = useDates();
  const { colors } = useAppTheme();
  const query = adminQuery.statementImports();
  const imports = useResource<StatementImport[]>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const [provider, setProvider] = useState<StatementProvider>("ESEWA");
  const [uploading, setUploading] = useState(false);
  // Once per mount: whether the module is linked cannot change while running.
  const [canPick] = useState(() => pickerAvailable());
  const [openId, setOpenId] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<StatementImport | null>(null);
  const [bucket, setBucket] = useState<Bucket>("tied");
  const [guess, setGuess] = useState<Guess>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<OrphanRow | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [helping, setHelping] = useState(false);
  const [busy, setBusy] = useState(false);

  const view = useResource<ReconciliationView | null>(
    useCallback(() => (openId ? getReconciliation(openId) : Promise.resolve(null)), [openId]),
  );

  const { reload } = imports;

  const upload = useCallback(
    async (as: StatementProvider) => {
      const picker = loadDocumentPicker();

      if (!picker) {
        toastError(
          "This build cannot open files",
          "The file picker is a native module added after this app was built. Everything else on this screen works — a new build switches importing back on.",
        );
        return;
      }

      const picked = await picker.getDocumentAsync({
        // The parsers read CSV and XLSX. A PDF statement has to be exported
        // first, which every bank and both wallets offer — accepting one here
        // would fail at parse time with a message about columns nobody can act
        // on.
        type: [
          "text/csv",
          "text/comma-separated-values",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
      });

      const file = picked.canceled ? null : picked.assets?.[0];

      if (!file) {
        return;
      }

      setUploading(true);

      try {
        const assetId = await uploadAsset(
          {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.mimeType ?? "text/csv",
            uri: file.uri,
          },
          { kind: "STATEMENT", label: `${providerLabel(as)} statement` },
        );

        const result = await importStatement({ assetId, provider: as });

        toastSuccess(
          `Read ${result.rowCount} payments`,
          `${result.matchedCount} tied to bills, ${result.orphanCount} need you.`,
        );
        setOpenId(result.statementImportId);
        await reload();
      } catch (error) {
        toastError("Could not read that", readApiError(error, "The file did not import."));
      } finally {
        setUploading(false);
      }
    },
    [reload],
  );

  /** Re-pick the same file against the type the server said it looked like. */
  const retryAs = useCallback(
    (as: StatementProvider) => {
      setProvider(as);
      void upload(as);
    },
    [upload],
  );

  const approveAll = useCallback(async () => {
    if (!openId) {
      return;
    }

    setBusy(true);

    try {
      await approveMatchedStatement(openId);
      toastSuccess("Recorded", "Every tied payment is now against its bill.");
      await view.reload();
      await reload();
    } catch (error) {
      toastError("Could not record", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [openId, reload, view]);

  const assign = useCallback(
    async (eventId: string, invoiceId: string, name: string) => {
      setBusy(true);

      try {
        await assignOrphanPayment(eventId, invoiceId);
        toastSuccess("Assigned", `That payment is now against ${name}'s bill.`);
        setPending(null);
        setChoice(null);
        await view.reload();
      } catch (error) {
        toastError("Could not assign", readApiError(error));
      } finally {
        setBusy(false);
      }
    },
    [view],
  );

  const reconciliation = view.data ?? null;
  const buckets = reconciliation?.buckets ?? null;

  const counts = useMemo(
    () => ({
      action: buckets?.orphans.length ?? 0,
      missing: buckets?.approvedNotInStatement.length ?? 0,
      norecord: buckets?.claimedNoTransaction.length ?? 0,
      tied: buckets?.matched.length ?? 0,
    }),
    [buckets],
  );

  /**
   * Where the sheet lands when it opens.
   *
   * "Tied to bills" first, because it is the reassuring answer and usually the
   * biggest — but only if it has anything in it. The old screen always opened
   * on it, so an import whose one credit needed a decision greeted the owner
   * with an empty state and a screenful of white while the work hid behind a
   * tab. A bucket with nothing in it is never worth showing first.
   */
  const openSheet = useCallback(
    (statementImportId: string, entry: StatementImport) => {
      setOpenId(statementImportId);
      setOpenEntry(entry);
      setGuess("all");
      setCollapsed({});
      setBucket(entry.matchedCount > 0 || entry.orphanCount === 0 ? "tied" : "action");
    },
    [],
  );

  const settleCount = buckets?.matched.filter((row) => row.status !== "SETTLED").length ?? 0;

  const orphans = useMemo(() => {
    const all = buckets?.orphans ?? [];

    if (guess === "guessed") {
      return all.filter((row) => row.suggestions.length > 0);
    }

    if (guess === "unknown") {
      return all.filter((row) => row.suggestions.length === 0);
    }

    return all;
  }, [buckets, guess]);

  const settled = buckets?.matched.filter((row) => row.status === "SETTLED") ?? [];
  const waiting = buckets?.matched.filter((row) => row.status !== "SETTLED") ?? [];

  const meta = BUCKETS[bucket];

  return (
    <Screen
      header={
        <AppBar
          accent
          actions={
            <IconButton
              label="What this screen does"
              name="help-circle-outline"
              onPress={() => setHelping(true)}
              tone="onAccent"
            />
          }
          centerTitle
          showBack
          subtitle="Did the money reach your account?"
          title="Reconcile"
        />
      }
      onRefresh={imports.refresh}
      padded={false}
      refreshing={imports.refreshing}
      scroll
    >
      <View className="gap-6 px-5 pt-4">
        {/* ---------------------------------------------------------------- */}
        {/*
          Not straddling the bar, though NOTES §1 wants it to.
          `Screen`'s body is a ScrollView, and a ScrollView clips its content to
          its own bounds — a negative `marginTop` here does not ride up onto the
          painted edge, it has its top 22 points cut off, border and rounded
          corners with it. The straddle only works from the `header` slot (see
          `finance/statement.tsx`), and this card is far too tall to sit there
          and never scroll.
        */}
        <Card className="gap-3">
          <View>
            <Text variant="subtitle">1. Import your statement</Text>
            <Text variant="caption">Upload a file from your bank or wallet.</Text>
          </View>

          <Select
            label="From"
            onChange={setProvider}
            options={PROVIDER_OPTIONS}
            value={provider}
          />

          <Button
            disabled={!canPick}
            label="Choose a file"
            loading={uploading}
            onPress={() => void upload(provider)}
          />

          <Text className="text-center" variant="caption">
            CSV or XLSX only
          </Text>

          {canPick ? null : (
            /*
             * Said up front rather than after a tap. The file picker is native
             * and this build predates it; the rest of the screen — past
             * imports, the four buckets, recording and assigning — is plain
             * HTTP and works exactly as it will after a rebuild.
             */
            <View className="gap-1 rounded-xl border border-warning/40 bg-warning-soft p-3">
              <Text variant="label">Importing needs a newer build</Text>
              <Text variant="caption">
                Files already imported can still be checked here.
              </Text>
            </View>
          )}
        </Card>

        {/* ---------------------------------------------------------------- */}
        <View>
          <SectionHeader
            action={
              <Button
                label="Refresh"
                onPress={() => void imports.reload()}
                size="sm"
                variant="ghost"
              />
            }
            subtitle="Newest first"
            title="2. Recent imports"
          />

          {imports.loading ? <SkeletonCard rows={2} /> : null}

          {imports.error ? (
            <ErrorState message={imports.error} onRetry={imports.reload} />
          ) : null}

          {!imports.loading && (imports.data ?? []).length === 0 ? (
            <EmptyCard
              description="Import one and every payment in it is checked against what residents said they paid."
              title="Nothing imported yet"
            />
          ) : null}

          <View className="gap-3">
            {(imports.data ?? []).map((entry) => {
              const failure =
                entry.status === "FAILED" ? readFailure(entry.errorDetail) : null;

              return (
                <Card className="gap-3" key={entry.statementImportId}>
                  <View className="flex-row items-start gap-3">
                    <View className="h-10 w-10 items-center justify-center rounded-full bg-brand-soft">
                      {PROVIDER_MARK[entry.provider] ? (
                        <Text className="text-lg font-semibold text-primary">
                          {PROVIDER_MARK[entry.provider]}
                        </Text>
                      ) : (
                        <Ionicons
                          color={colors.primary}
                          name="document-outline"
                          size={20}
                        />
                      )}
                    </View>

                    <View className="flex-1">
                      <Text variant="label">
                        {`${providerLabel(entry.provider)} · ${dates.dateTime(entry.uploadedAt)}`}
                      </Text>
                      {/*
                        The filename, demoted. It used to be the heading — sixty
                        characters of `TransactionHistory-2026-08-10-1357…`
                        wrapping over two lines and telling the owner nothing.
                        It still identifies the file they picked, so it stays,
                        one line, in caption grey.
                      */}
                      <Text numberOfLines={1} variant="caption">
                        {entry.fileName || "Untitled file"}
                      </Text>
                    </View>

                    <Badge
                      label={
                        entry.status === "READY"
                          ? "Ready"
                          : (failure?.label ?? humanizeEnum(entry.status))
                      }
                      tone={
                        entry.status === "READY"
                          ? "success"
                          : failure?.suggested
                            ? "warning"
                            : entry.status === "FAILED"
                              ? "danger"
                              : "warning"
                      }
                    />
                  </View>

                  {entry.status === "FAILED" ? (
                    <View className="gap-3">
                      <Text variant="caption">
                        {entry.errorDetail ?? "We couldn't read this file. Please try again."}
                      </Text>

                      <RetryAs
                        busy={uploading}
                        onRetry={retryAs}
                        provider={failure?.suggested ?? null}
                      />
                    </View>
                  ) : entry.status === "READY" ? (
                    <>
                      <View className="flex-row">
                        {[
                          { label: "Payments", value: entry.rowCount },
                          { label: "Tied to bills", value: entry.matchedCount },
                          { label: "Need you", value: entry.orphanCount },
                        ].map((stat) => (
                          <View className="flex-1" key={stat.label}>
                            <Text className="text-lg font-semibold tracking-tight text-foreground">
                              {stat.value}
                            </Text>
                            <Text variant="caption">{stat.label}</Text>
                          </View>
                        ))}
                      </View>

                      <Button
                        label="View results"
                        onPress={() => openSheet(entry.statementImportId, entry)}
                        size="sm"
                        variant="outline"
                      />
                    </>
                  ) : (
                    <Text variant="caption">Still reading this file.</Text>
                  )}
                </Card>
              );
            })}
          </View>
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        /*
          Nothing to record means no footer at all. The sheet's own X closes it,
          so a pinned "Close" is a full-width button whose only job is something
          the header, the drag and the backdrop already do — and it costs the
          list a row of height on every bucket that has no action.
        */
        footer={
          settleCount > 0 && bucket === "tied" ? (
            <View className="gap-2">
              <Button
                label={`Record all ${settleCount} tied payments`}
                loading={busy}
                onPress={() => void approveAll()}
              />
              <Text className="text-center" variant="caption">
                We will record these against their bills.
              </Text>
            </View>
          ) : undefined
        }
        onClose={() => setOpenId(null)}
        open={openId !== null}
        tall
        title={
          openEntry
            ? `${providerLabel(openEntry.provider)} · ${dates.dateTime(openEntry.uploadedAt)}`
            : "Results"
        }
      >
        {/*
          Keyed off the absence of data, not off `loading`.

          `useResource` reports `loading: false` for the frame between the sheet
          opening and its effect firing, and the sheet is tall — on a real
          device that was three seconds of a blank white sheet with a Close
          button, which reads as a screen that failed rather than one that is
          working.
        */}
        {!reconciliation && !view.error ? <SkeletonCard rows={4} /> : null}

        {view.error ? <ErrorState message={view.error} onRetry={view.reload} /> : null}

        {reconciliation && buckets ? (
          <View className="gap-4 pb-2">
            <Grid gap={10} maxColumns={2} minCellWidth={140}>
              {[
                <StatTile
                  icon="list-outline"
                  key="rows"
                  label="Payments read"
                  value={String(reconciliation.rowCount)}
                />,
                <StatTile
                  icon="shield-checkmark-outline"
                  key="tied"
                  label="Tied to bills"
                  tone="success"
                  value={String(counts.tied)}
                />,
                <StatTile
                  icon="help-circle-outline"
                  key="action"
                  label="Needs your action"
                  tone="warning"
                  value={String(counts.action)}
                />,
                <StatTile
                  icon="alert-circle-outline"
                  key="missing"
                  label="Not in your account"
                  tone="danger"
                  value={String(counts.missing)}
                />,
              ]}
            </Grid>

            <Segmented
              onChange={setBucket}
              options={BUCKET_ORDER.map((value) => ({
                count: counts[value],
                label: BUCKETS[value].label,
                value,
              }))}
              value={bucket}
            />

            {/*
              One tinted sentence per bucket, above the list. The four buckets
              are only meaningful against each other, and an owner who has never
              met the word "reconciliation" needs to be told which one they are
              looking at in words, not by the colour of a chip.
            */}
            <View className={`flex-row gap-3 rounded-2xl border p-3 ${meta.surface}`}>
              <Ionicons
                color={
                  meta.tone === "brand"
                    ? colors.primary
                    : meta.tone === "danger"
                      ? colors.destructive
                      : meta.tone === "warning"
                        ? colors.warning
                        : colors.mutedForeground
                }
                name={meta.icon}
                size={20}
              />
              <View className="flex-1">
                <Text variant="label">{meta.lead}</Text>
                <Text variant="caption">{meta.why}</Text>
              </View>
            </View>

            {counts[bucket] === 0 ? (
              <Text className="py-6 text-center" variant="muted">
                {meta.empty}
              </Text>
            ) : null}

            {/* -------------------------------------------------------------- */}
            {bucket === "tied" && counts.tied > 0 ? (
              <View className="gap-3">
                <Group
                  count={settled.length}
                  icon="checkmark-circle-outline"
                  onToggle={() =>
                    setCollapsed((current) => ({ ...current, settled: !current.settled }))
                  }
                  open={!collapsed.settled}
                  subtitle="Already recorded as paid in your system."
                  title="Already recorded"
                >
                  {settled.map((row) => (
                    <PaymentRow
                      amount={row.amount}
                      key={row.eventId}
                      note={row.confirmsClaim ? "Confirms what the resident told you" : null}
                      subtitle={row.period ? dates.period(row.period) : "One-off charge"}
                      title={row.residentName}
                      when={dates.dateTime(row.occurredAt)}
                    />
                  ))}
                </Group>

                <Group
                  count={waiting.length}
                  icon="time-outline"
                  onToggle={() =>
                    setCollapsed((current) => ({ ...current, waiting: !current.waiting }))
                  }
                  open={!collapsed.waiting}
                  subtitle="Received, but not recorded yet."
                  title="Waiting for you"
                >
                  {waiting.map((row) => (
                    <PaymentRow
                      amount={row.amount}
                      key={row.eventId}
                      note={row.confirmsClaim ? "Confirms what the resident told you" : null}
                      subtitle={row.period ? dates.period(row.period) : "One-off charge"}
                      title={row.residentName}
                      when={dates.dateTime(row.occurredAt)}
                    />
                  ))}
                </Group>
              </View>
            ) : null}

            {/* -------------------------------------------------------------- */}
            {bucket === "action" && counts.action > 0 ? (
              <View className="gap-3">
                <Segmented
                  onChange={setGuess}
                  options={[
                    { count: counts.action, label: "All", value: "all" },
                    {
                      count: (buckets.orphans ?? []).filter(
                        (row) => row.suggestions.length > 0,
                      ).length,
                      label: "We guessed",
                      value: "guessed",
                    },
                    {
                      count: (buckets.orphans ?? []).filter(
                        (row) => row.suggestions.length === 0,
                      ).length,
                      label: "No guess",
                      value: "unknown",
                    },
                  ]}
                  value={guess}
                />

                {orphans.length === 0 ? (
                  <Text className="py-6 text-center" variant="muted">
                    Nothing in this group.
                  </Text>
                ) : null}

                {orphans.map((row) => {
                  const best = row.suggestions[0] ?? null;

                  return (
                    <Pressable
                      accessibilityHint="Opens the payment so you can assign it"
                      accessibilityRole="button"
                      className="flex-row items-center gap-3 rounded-2xl border border-border bg-card p-3 active:opacity-80"
                      key={row.eventId}
                      onPress={() => {
                        setPending(row);
                        setChoice(best?.invoiceId ?? null);
                      }}
                    >
                      <View className="h-9 w-9 items-center justify-center rounded-xl bg-warning-soft">
                        <Ionicons
                          color={colors.warning}
                          name="help-circle-outline"
                          size={18}
                        />
                      </View>

                      <View className="flex-1">
                        <Money size="large" value={row.amount} />
                        <Text variant="caption">{dates.dateTime(row.occurredAt)}</Text>
                        {row.counterpartyName ? (
                          <Text numberOfLines={1} variant="caption">
                            {row.counterpartyName}
                          </Text>
                        ) : null}
                      </View>

                      <View className="max-w-[42%] items-end">
                        {best ? (
                          <>
                            <Text variant="caption">Suggested for</Text>
                            <Text numberOfLines={1} variant="label">
                              {best.residentName}
                            </Text>
                            <Text variant="caption">
                              {`${humanizeEnum(best.confidence)} match`}
                            </Text>
                          </>
                        ) : (
                          <Text className="text-right" variant="caption">
                            No name on it
                          </Text>
                        )}
                      </View>

                      <Ionicons
                        color={colors.mutedForeground}
                        name="chevron-forward"
                        size={18}
                      />
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {/* -------------------------------------------------------------- */}
            {bucket === "missing" && counts.missing > 0
              ? buckets.approvedNotInStatement.map((row) => (
                  <View
                    className="gap-1 rounded-2xl border border-destructive/40 bg-destructive-soft p-3"
                    key={row.claimEventId}
                  >
                    <View className="flex-row items-start gap-2">
                      <View className="flex-1">
                        <Text variant="label">{row.residentName}</Text>
                        <Text variant="caption">
                          {`Approved by ${row.approvedByName ?? "a staff member"}${
                            row.approvedAt ? ` on ${dates.date(row.approvedAt)}` : ""
                          }`}
                        </Text>
                      </View>
                      <Money owed value={row.amount} />
                    </View>
                    <Text variant="caption">{row.why}</Text>
                  </View>
                ))
              : null}

            {/* -------------------------------------------------------------- */}
            {bucket === "norecord" && counts.norecord > 0
              ? buckets.claimedNoTransaction.map((row) => (
                  <View
                    className="gap-1 rounded-2xl border border-border p-3"
                    key={row.claimEventId}
                  >
                    <View className="flex-row items-start gap-2">
                      <View className="flex-1">
                        <Text variant="label">{row.residentName ?? "A resident"}</Text>
                        <Text variant="caption">
                          {[row.bedLabel, dates.period(row.period)]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                      <Money value={row.amount} />
                    </View>
                    {row.why ? <Text variant="caption">{row.why}</Text> : null}
                  </View>
                ))
              : null}
          </View>
        ) : null}
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      {/*
        Assigning is the one irreversible act on this screen, and it used to be a
        single tap on a chip the size of a fingernail. It now costs a sheet that
        names the person, the amount and why we think it is them.
      */}
      <Sheet
        footer={
          pending && pending.suggestions.length > 0 ? (
            <Button
              disabled={!choice}
              label={`Assign to ${
                pending.suggestions.find((one) => one.invoiceId === choice)?.residentName ??
                "this resident"
              }`}
              loading={busy}
              onPress={() => {
                const picked = pending.suggestions.find((one) => one.invoiceId === choice);

                if (picked) {
                  void assign(pending.eventId, picked.invoiceId, picked.residentName);
                }
              }}
            />
          ) : undefined
        }
        onClose={() => setPending(null)}
        open={pending !== null}
        title="Who sent this?"
      >
        {pending ? (
          <View className="gap-4 pb-2">
            <Card className="gap-2">
              <Money size="display" value={pending.amount} />
              <Text variant="caption">{dates.dateTime(pending.occurredAt)}</Text>
              {pending.counterpartyName ? (
                <Text variant="caption">{`Sent by ${pending.counterpartyName}`}</Text>
              ) : null}
              {pending.remarks ? (
                <Text variant="caption">{`Their note: ${pending.remarks}`}</Text>
              ) : null}
            </Card>

            {pending.suggestions.length === 0 ? (
              <View className="gap-1 rounded-2xl border border-border bg-muted p-3">
                <Text variant="label">Nothing on this payment names a resident</Text>
                <Text variant="caption">
                  No name, no reference code we recognise. Ask around the hostel who paid
                  this amount that day, then record it from their own page.
                </Text>
              </View>
            ) : (
              <View className="gap-2">
                <Text variant="caption">Tap the right person, then assign.</Text>

                <Card padding="px-0 py-1">
                  {pending.suggestions.map((suggestion: Suggestion) => (
                    <SheetRow
                      key={suggestion.invoiceId}
                      label={suggestion.residentName}
                      onPress={() => setChoice(suggestion.invoiceId)}
                      selected={choice === suggestion.invoiceId}
                      subtitle={`${humanizeEnum(suggestion.confidence)} match · ${suggestion.why}`}
                      trailing={
                        choice === suggestion.invoiceId ? (
                          <Ionicons
                            color={colors.primary}
                            name="checkmark-circle"
                            size={22}
                          />
                        ) : null
                      }
                    />
                  ))}
                </Card>
              </View>
            )}
          </View>
        ) : null}
      </Sheet>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={<Button label="Got it" onPress={() => setHelping(false)} />}
        onClose={() => setHelping(false)}
        open={helping}
        title="What this screen does"
      >
        <View className="gap-4 pb-2">
          <Text variant="caption">
            Residents tell you they paid. This screen checks that against the money your
            bank and wallets actually received.
          </Text>

          {BUCKET_ORDER.map((value) => (
            <View className="gap-1" key={value}>
              <Text variant="label">{BUCKETS[value].label}</Text>
              <Text variant="caption">{`${BUCKETS[value].lead} ${BUCKETS[value].why}`}</Text>
            </View>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

/** The one-tap fix for the commonest failure: the same file, the right type. */
function RetryAs({
  busy,
  onRetry,
  provider,
}: {
  busy: boolean;
  onRetry: (provider: StatementProvider) => void;
  provider: StatementProvider | null;
}) {
  if (!provider) {
    return null;
  }

  return (
    <Button
      label={`Try again as ${providerLabel(provider)}`}
      loading={busy}
      onPress={() => onRetry(provider)}
      size="sm"
      variant="outline"
    />
  );
}

/**
 * A collapsible group inside a bucket.
 *
 * "Tied to bills" is two different facts wearing one label — money already
 * recorded, and money still waiting for the owner to record it — and only the
 * second needs anything from them. Splitting them into groups that fold lets an
 * owner with thirty settled payments get them out of the way in one tap.
 */
function Group({
  children,
  count,
  icon,
  onToggle,
  open,
  subtitle,
  title,
}: {
  children: ReactNode;
  count: number;
  icon: keyof typeof Ionicons.glyphMap;
  onToggle: () => void;
  open: boolean;
  subtitle: string;
  title: string;
}) {
  const { colors } = useAppTheme();

  if (count === 0) {
    return null;
  }

  return (
    <View className="overflow-hidden rounded-2xl border border-border">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="flex-row items-center gap-3 bg-card p-3 active:opacity-80"
        onPress={onToggle}
      >
        <Ionicons color={colors.mutedForeground} name={icon} size={20} />
        <View className="flex-1">
          <Text variant="label">{`${title} (${count})`}</Text>
          <Text variant="caption">{subtitle}</Text>
        </View>
        <Ionicons
          color={colors.mutedForeground}
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
        />
      </Pressable>

      {open ? <View className="gap-3 p-3 pt-0">{children}</View> : null}
    </View>
  );
}

/** One settled or waiting payment: who, which month, how much, when. */
function PaymentRow({
  amount,
  note,
  subtitle,
  title,
  when,
}: {
  amount: number;
  note: string | null;
  subtitle: string;
  title: string;
  when: string;
}) {
  return (
    <View className="flex-row items-start gap-2 border-t border-border pt-3">
      <View className="flex-1">
        <Text variant="label">{title}</Text>
        <Text variant="caption">{subtitle}</Text>
        {note ? <Text variant="caption">{note}</Text> : null}
      </View>
      <View className="items-end">
        <Money value={amount} />
        <Text variant="caption">{when}</Text>
      </View>
    </View>
  );
}
