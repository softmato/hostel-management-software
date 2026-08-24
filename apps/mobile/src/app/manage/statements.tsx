import { useCallback, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Chip, StatTile } from "@/components/ui/layout";
import { Money } from "@/components/ui/money";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { EmptyCard, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useResource } from "@/hooks/use-resource";
import {
  approveMatchedStatement,
  assignOrphanPayment,
  getReconciliation,
  importStatement,
  listStatementImports,
  type ReconciliationView,
  type StatementImport,
  type StatementProvider,
} from "@/lib/admin-manage-api";
import { readApiError } from "@/lib/api-contract";
import { formatDate, formatDateTime, humanizeEnum } from "@/lib/format";
import { toastError, toastSuccess } from "@/lib/toast";
import { uploadAsset } from "@/lib/uploads";

/**
 * Statement reconciliation — the answer to "did the money actually arrive".
 *
 * ## Why this is not optional bookkeeping
 *
 * Payee matching on a payment screenshot is best-effort: a crop, an unfamiliar
 * template or a competent forgery defeats it. So the guarantee the product
 * actually makes is narrower and stronger — **either the money appears in the
 * hostel's own account, or the claim appears in the "approved, never arrived"
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
 * ## What the phone cannot do here
 *
 * Nothing, as it turns out. The web's version of this screen is three tables;
 * the work in it is a sequence of one-tap decisions on individual rows, which is
 * a better fit for a phone than for a spreadsheet — the reason it was a browser
 * link was that nobody had built it.
 */

type Bucket = "matched" | "orphans" | "approved" | "claimed";

const PROVIDER_OPTIONS = [
  { description: "A wallet transaction export.", label: "eSewa", value: "ESEWA" },
  { description: "A wallet transaction export.", label: "Khalti", value: "KHALTI" },
  { description: "A bank account statement.", label: "Bank", value: "BANK" },
] as const;

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

export default function ManageStatementsScreen() {
  const imports = useResource<StatementImport[]>(
    useCallback(() => listStatementImports(), []),
  );

  const [provider, setProvider] = useState<StatementProvider>("ESEWA");
  const [uploading, setUploading] = useState(false);
  // Once per mount: whether the module is linked cannot change while running.
  const [canPick] = useState(() => pickerAvailable());
  const [openId, setOpenId] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>("matched");
  const [busy, setBusy] = useState(false);

  const view = useResource<ReconciliationView | null>(
    useCallback(() => (openId ? getReconciliation(openId) : Promise.resolve(null)), [openId]),
  );

  const { reload } = imports;

  const upload = useCallback(async () => {
    const picker = loadDocumentPicker();

    if (!picker) {
      toastError(
        "This build cannot open files",
        "The file picker is a native module added after this app was built. Everything else on this screen works — a new build switches importing back on.",
      );
      return;
    }

    const picked = await picker.getDocumentAsync({
      // The parsers read CSV and XLSX. A PDF statement has to be exported first,
      // which every bank and both wallets offer — accepting one here would fail
      // at parse time with a message about columns nobody can act on.
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
        { kind: "STATEMENT", label: `${humanizeEnum(provider)} statement` },
      );

      const result = await importStatement({ assetId, provider });

      toastSuccess(
        `Read ${result.rowCount} row(s)`,
        `${result.matchedCount} matched, ${result.orphanCount} unmatched.`,
      );
      setOpenId(result.statementImportId);
      await reload();
    } catch (error) {
      toastError("Could not read that", readApiError(error, "The statement did not import."));
    } finally {
      setUploading(false);
    }
  }, [provider, reload]);

  const approveAll = useCallback(async () => {
    if (!openId) {
      return;
    }

    setBusy(true);

    try {
      await approveMatchedStatement(openId);
      toastSuccess("Settled", "Every matched row is now recorded against its invoice.");
      await view.reload();
      await reload();
    } catch (error) {
      toastError("Could not settle", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [openId, reload, view]);

  const assign = useCallback(
    async (eventId: string, invoiceId: string) => {
      setBusy(true);

      try {
        await assignOrphanPayment(eventId, invoiceId);
        toastSuccess("Assigned", "The credit is now against that invoice.");
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

  return (
    <Screen
      header={<AppBar accent centerTitle showBack subtitle="Bank and wallet" title="Statements" />}
      onRefresh={imports.refresh}
      refreshing={imports.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader
            subtitle="A CSV or XLSX export. PDFs cannot be read — export the file instead."
            title="Import a statement"
          />
          <Card className="gap-3">
            <Select
              label="Where it came from"
              onChange={setProvider}
              options={PROVIDER_OPTIONS}
              value={provider}
            />

            <Button
              disabled={!canPick}
              label="Choose a file"
              loading={uploading}
              onPress={() => void upload()}
            />

            {canPick ? (
              <Text variant="caption">
                Reading a statement settles the rows whose reference codes check out, so
                it moves money — it needs the payment-approval permission, and every row
                it touches is on the audit trail.
              </Text>
            ) : (
              /*
               * Said up front rather than after a tap. The file picker is native
               * and this build predates it; the rest of the screen — past
               * imports, the four reconciliation buckets, settling and assigning
               * — is plain HTTP and works exactly as it will after a rebuild.
               */
              <View className="gap-1 rounded-xl border border-warning/40 bg-warning-soft p-3">
                <Text variant="label">Importing needs a newer build</Text>
                <Text variant="caption">
                  Opening the file browser is native code that was added after this
                  app was installed. Reconciling statements already imported works
                  here now.
                </Text>
              </View>
            )}
          </Card>
        </View>

        <View>
          <SectionHeader subtitle="Newest first" title="Past imports" />

          {imports.loading ? <LoadingState label="Reading past imports" /> : null}

          {imports.error ? (
            <ErrorState message={imports.error} onRetry={imports.reload} />
          ) : null}

          {!imports.loading && (imports.data ?? []).length === 0 ? (
            <EmptyCard
              description="Import one and every credit in it is checked against what residents said they paid."
              title="Nothing imported yet"
            />
          ) : null}

          <View className="gap-3">
            {(imports.data ?? []).map((entry) => (
              <Card className="gap-2" key={entry.statementImportId}>
                <View className="flex-row items-start gap-2">
                  <View className="flex-1">
                    <Text variant="label">
                      {entry.fileName || `${humanizeEnum(entry.provider)} statement`}
                    </Text>
                    <Text variant="caption">
                      {`${humanizeEnum(entry.provider)} · ${formatDate(entry.uploadedAt)}`}
                    </Text>
                  </View>
                  <Badge
                    label={humanizeEnum(entry.status)}
                    tone={
                      entry.status === "READY"
                        ? "success"
                        : entry.status === "FAILED"
                          ? "danger"
                          : "warning"
                    }
                  />
                </View>

                {entry.status === "FAILED" ? (
                  <Text variant="caption">
                    {entry.errorDetail ?? "The file could not be read."}
                  </Text>
                ) : (
                  <View className="flex-row flex-wrap gap-2">
                    <Chip icon="list-outline" label={`${entry.rowCount} row(s)`} />
                    <Chip
                      icon="checkmark-circle-outline"
                      label={`${entry.matchedCount} matched`}
                      tone={entry.matchedCount > 0 ? "brand" : "neutral"}
                    />
                    <Chip
                      icon="help-circle-outline"
                      label={`${entry.orphanCount} unmatched`}
                    />
                  </View>
                )}

                {entry.status === "READY" ? (
                  <Button
                    label="Open"
                    onPress={() => {
                      setOpenId(entry.statementImportId);
                      setBucket("matched");
                    }}
                    size="sm"
                    variant="outline"
                  />
                ) : null}
              </Card>
            ))}
          </View>
        </View>
      </View>

      {/* ------------------------------------------------------------------ */}
      <Sheet
        footer={
          buckets && buckets.matched.some((row) => row.status !== "SETTLED") ? (
            <Button
              label="Settle every matched row"
              loading={busy}
              onPress={() => void approveAll()}
            />
          ) : (
            <Button label="Close" onPress={() => setOpenId(null)} variant="outline" />
          )
        }
        onClose={() => setOpenId(null)}
        open={openId !== null}
        title={reconciliation?.fileName || "Reconciliation"}
      >
        {view.loading ? <LoadingState label="Matching against your invoices" /> : null}

        {reconciliation && buckets ? (
          <View className="gap-3 pb-2">
            <View className="flex-row gap-3">
              <StatTile
                icon="list-outline"
                label="Rows"
                value={String(reconciliation.rowCount)}
              />
              <StatTile
                icon="checkmark-circle-outline"
                label="Matched"
                tone="success"
                value={String(buckets.matched.length)}
              />
              <StatTile
                icon="cash-outline"
                label="Value"
                tone="brand"
                value={String(reconciliation.matchedTotal)}
              />
            </View>

            <Segmented
              onChange={setBucket}
              options={[
                { count: buckets.matched.length, label: "Matched", value: "matched" },
                { count: buckets.orphans.length, label: "Unmatched", value: "orphans" },
                {
                  count: buckets.approvedNotInStatement.length,
                  label: "Never arrived",
                  value: "approved",
                },
                {
                  count: buckets.claimedNoTransaction.length,
                  label: "No record",
                  value: "claimed",
                },
              ]}
              value={bucket}
            />

            {bucket === "matched" ? (
              buckets.matched.length === 0 ? (
                <Text variant="muted">Nothing in this file tied to an invoice.</Text>
              ) : (
                buckets.matched.map((row) => (
                  <View className="gap-1 rounded-xl border border-border p-3" key={row.eventId}>
                    <View className="flex-row items-start gap-2">
                      <View className="flex-1">
                        <Text variant="label">{row.residentName}</Text>
                        <Text variant="caption">
                          {`${formatDateTime(row.occurredAt)}${row.period ? ` · ${row.period}` : ""}`}
                        </Text>
                      </View>
                      <Money value={row.amount} />
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                      <Badge
                        label={row.status === "SETTLED" ? "Settled" : "Waiting"}
                        tone={row.status === "SETTLED" ? "success" : "warning"}
                      />
                      {row.confirmsClaim ? (
                        <Badge label="Confirms an approved claim" tone="info" />
                      ) : null}
                      {row.referenceCode ? <Chip label={row.referenceCode} /> : null}
                    </View>
                    <Text variant="caption">{row.why}</Text>
                  </View>
                ))
              )
            ) : null}

            {bucket === "orphans" ? (
              buckets.orphans.length === 0 ? (
                <Text variant="muted">Every credit in this file found an invoice.</Text>
              ) : (
                buckets.orphans.map((row) => (
                  <View className="gap-2 rounded-xl border border-border p-3" key={row.eventId}>
                    <View className="flex-row items-start gap-2">
                      <View className="flex-1">
                        <Text variant="label">{row.counterpartyName || "Unnamed credit"}</Text>
                        <Text variant="caption">
                          {`${formatDateTime(row.occurredAt)}${row.providerTxnId ? ` · ${row.providerTxnId}` : ""}`}
                        </Text>
                      </View>
                      <Money value={row.amount} />
                    </View>

                    {row.remarks ? <Text variant="caption">{row.remarks}</Text> : null}

                    {row.suggestions.length === 0 ? (
                      <Text variant="caption">
                        Nothing here names a resident. It stays unclaimed until somebody
                        recognises it.
                      </Text>
                    ) : (
                      <>
                        <Text variant="caption">Probably:</Text>
                        <View className="flex-row flex-wrap gap-2">
                          {row.suggestions.map((suggestion) => (
                            <Chip
                              key={suggestion.invoiceId}
                              label={`${suggestion.residentName} · ${humanizeEnum(suggestion.confidence)}`}
                              onPress={() => void assign(row.eventId, suggestion.invoiceId)}
                              tone="brand"
                            />
                          ))}
                        </View>
                        <Text variant="caption">{row.suggestions[0]?.why}</Text>
                      </>
                    )}
                  </View>
                ))
              )
            ) : null}

            {bucket === "approved" ? (
              buckets.approvedNotInStatement.length === 0 ? (
                <Text variant="muted">
                  Every claim your staff approved has turned up in an account. This is the
                  bucket you want empty.
                </Text>
              ) : (
                <>
                  <Text variant="caption">
                    Approved on the strength of a screenshot, and no statement has ever
                    carried the money. Worth a conversation with both people named.
                  </Text>
                  {buckets.approvedNotInStatement.map((row) => (
                    <View
                      className="gap-1 rounded-xl border border-destructive/40 bg-destructive/5 p-3"
                      key={row.claimEventId}
                    >
                      <View className="flex-row items-start gap-2">
                        <View className="flex-1">
                          <Text variant="label">{row.residentName}</Text>
                          <Text variant="caption">
                            {`Approved by ${row.approvedByName ?? "a staff member"}${row.approvedAt ? ` on ${formatDate(row.approvedAt)}` : ""}`}
                          </Text>
                        </View>
                        <Money owed value={row.amount} />
                      </View>
                      {row.transactionCode ? <Chip label={row.transactionCode} /> : null}
                      <Text variant="caption">{row.why}</Text>
                    </View>
                  ))}
                </>
              )
            ) : null}

            {bucket === "claimed" ? (
              buckets.claimedNoTransaction.length === 0 ? (
                <Text variant="muted">
                  Every open claim names a transaction this file could check.
                </Text>
              ) : (
                <>
                  <Text variant="caption">
                    Residents say they paid, and this file has no transaction matching what
                    they gave. Usually the wrong statement, occasionally not.
                  </Text>
                  {buckets.claimedNoTransaction.map((row) => (
                    <View
                      className="gap-1 rounded-xl border border-border p-3"
                      key={row.claimEventId}
                    >
                      <View className="flex-row items-start gap-2">
                        <View className="flex-1">
                          <Text variant="label">{row.residentName ?? "A resident"}</Text>
                          <Text variant="caption">
                            {[row.bedLabel, row.period].filter(Boolean).join(" · ")}
                          </Text>
                        </View>
                        <Money value={row.amount} />
                      </View>
                      {row.why ? <Text variant="caption">{row.why}</Text> : null}
                    </View>
                  ))}
                </>
              )
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}
