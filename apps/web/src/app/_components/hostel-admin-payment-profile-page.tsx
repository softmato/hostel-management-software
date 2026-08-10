"use client";

import { Banknote, QrCode, ShieldCheck, Smartphone } from "lucide-react";
import { memo, useCallback, useRef, useState, type FormEvent } from "react";

import {
  EmptyState,
  Input,
  LoadingRows,
  Panel,
  TextArea,
} from "@/app/_components/shared-ui";
import { browserApi } from "@/lib/browser-api";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { usePortalResource } from "@/lib/portal-query";
import { uploadFile } from "@/lib/uploads/uploader";
import { Message, PageHeader, field } from "./portal-shared";

/**
 * How this hostel takes money (target §11.8, plan item 3.1).
 *
 * Until this screen existed the product asked residents for proof of a payment
 * it gave them no instructions for, and every hostel communicated its account
 * details out of band (current §7.11). Everything here is what the resident pay
 * screen renders, which is why the banner at the top states plainly whether
 * residents can currently be told anything at all.
 */

type PaymentProfile = {
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankName: string | null;
  cashApprovalThreshold: number;
  displayName: string | null;
  enabledProviders: string[];
  esewaId: string | null;
  khaltiId: string | null;
  paymentInstructions: string | null;
  staticQrAssetId: string | null;
  tier: "TIER_0" | "TIER_1";
  usable: boolean;
};

export const HostelAdminPaymentProfilePageContent = memo(
  function HostelAdminPaymentProfilePageContent() {
    const [message, setMessage] = useState("");
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const qrInputRef = useRef<HTMLInputElement>(null);

    const resource = usePortalResource<{ profile: PaymentProfile }>(
      hostelAdminEndpoints.paymentProfile,
      { errorMessage: "Could not load the payment profile." },
    );
    const profile = resource.data?.profile ?? null;

    const patch = useCallback(
      async (body: Record<string, unknown>, note: string) => {
        await browserApi(hostelAdminEndpoints.paymentProfile, {
          body: JSON.stringify(body),
          method: "PATCH",
        });
        setMessage(note);
        await resource.refreshAsync();
      },
      [resource],
    );

    const save = useCallback(
      async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);

        setSaving(true);
        setMessage("");

        try {
          await patch(
            {
              bankAccountName: field(form, "bankAccountName"),
              bankAccountNumber: field(form, "bankAccountNumber"),
              bankName: field(form, "bankName"),
              cashApprovalThreshold: Number(field(form, "cashApprovalThreshold")),
              displayName: field(form, "displayName"),
              esewaId: field(form, "esewaId"),
              khaltiId: field(form, "khaltiId"),
              paymentInstructions: field(form, "paymentInstructions"),
            },
            "Payment details saved. Residents see these on their pay screen.",
          );
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : "Could not save payment details.",
          );
        } finally {
          setSaving(false);
        }
      },
      [patch],
    );

    const uploadQr = useCallback(
      async (file: File | undefined) => {
        if (!file) return;

        setUploading(true);
        setMessage("");

        try {
          // `PAYMENT_QR` is a financial kind, so presign scopes the asset to this
          // hostel (item 0.1) — which is also what lets the service refuse a QR
          // borrowed from somewhere else.
          const result = await uploadFile(file, {
            assetKind: "PAYMENT_QR",
            kind: "image",
            label: "Payment QR",
            silent: true,
          });

          if (!result?.assetId) {
            setMessage("The QR image could not be uploaded.");
            return;
          }

          await patch({ staticQrAssetId: result.assetId }, "Payment QR updated.");
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : "Could not save the QR image.",
          );
        } finally {
          setUploading(false);
          if (qrInputRef.current) qrInputRef.current.value = "";
        }
      },
      [patch],
    );

    const removeQr = useCallback(async () => {
      setUploading(true);

      try {
        await patch({ staticQrAssetId: null }, "Payment QR removed.");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not remove the QR image.",
        );
      } finally {
        setUploading(false);
      }
    }, [patch]);

    return (
      <div className="mx-auto max-w-[1100px] space-y-6">
        <PageHeader
          description="The account details, QR and instructions residents see when they open an invoice."
          icon={Banknote}
          title="Payment Setup"
        />
        <Message value={message} />

        {resource.state === "loading" ? <LoadingRows /> : null}
        {resource.state === "error" ? (
          <EmptyState label="The payment profile could not be loaded." />
        ) : null}

        {profile ? (
          <>
            <div
              className={`rounded-lg border p-4 text-sm ${
                profile.usable
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
              }`}
            >
              <p className="flex items-center gap-2 font-semibold">
                <ShieldCheck aria-hidden="true" className="size-4" />
                {profile.usable
                  ? "Residents can see how to pay you."
                  : "Residents cannot see how to pay you yet."}
              </p>
              <p className="mt-1 leading-5">
                {profile.usable
                  ? `Payments below are collected manually — you confirm each one from the review queue. ${
                      profile.enabledProviders.length > 0
                        ? `Online checkout is live for ${profile.enabledProviders.join(", ").toLowerCase()}, and settles without your review.`
                        : ""
                    }`
                  : "Add a payment QR, an eSewa or Khalti number, or a bank account below. Until then their pay screen says your hostel has not set this up."}
              </p>
            </div>

            <Panel title="Payment QR">
              <div className="flex flex-wrap items-start gap-5">
                {profile.staticQrAssetId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private asset served through our own authorizing route
                  <img
                    alt="Payment QR"
                    className="size-40 rounded-lg border border-border object-contain"
                    src={`/api/v1/files/${profile.staticQrAssetId}/url`}
                  />
                ) : (
                  <div className="flex size-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-muted-foreground">
                    <QrCode aria-hidden="true" className="size-7" />
                    <span className="text-xs">No QR uploaded</span>
                  </div>
                )}
                <div className="flex-1 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Screenshot or export the QR from your bank or wallet app. Residents
                    scan it and then upload their payment screenshot, so the name on the
                    QR should match the name below or they will hesitate to pay.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => void uploadQr(event.target.files?.[0])}
                      ref={qrInputRef}
                      type="file"
                    />
                    <button
                      className="rounded-md bg-role-admin px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                      disabled={uploading}
                      onClick={() => qrInputRef.current?.click()}
                      type="button"
                    >
                      {uploading
                        ? "Working…"
                        : profile.staticQrAssetId
                          ? "Replace QR"
                          : "Upload QR"}
                    </button>
                    {profile.staticQrAssetId ? (
                      <button
                        className="rounded-md border border-border px-4 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-60"
                        disabled={uploading}
                        onClick={() => void removeQr()}
                        type="button"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="Account details">
              <form
                className="grid gap-4"
                key={JSON.stringify(profile)}
                onSubmit={save}
              >
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Smartphone aria-hidden="true" className="size-4" />
                  Leave anything you do not accept blank — residents are only shown the
                  methods you fill in.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    defaultValue={profile.displayName ?? ""}
                    hint="Must match the registered name on the QR, or residents abandon the payment."
                    label="Account display name"
                    name="displayName"
                  />
                  <Input
                    defaultValue={profile.esewaId ?? ""}
                    hint="The eSewa mobile number or ID."
                    label="eSewa ID"
                    name="esewaId"
                  />
                  <Input
                    defaultValue={profile.khaltiId ?? ""}
                    hint="The Khalti mobile number or ID."
                    label="Khalti ID"
                    name="khaltiId"
                  />
                  <Input
                    defaultValue={profile.bankName ?? ""}
                    label="Bank name"
                    name="bankName"
                  />
                  <Input
                    defaultValue={profile.bankAccountName ?? ""}
                    label="Bank account name"
                    name="bankAccountName"
                  />
                  <Input
                    defaultValue={profile.bankAccountNumber ?? ""}
                    label="Bank account number"
                    name="bankAccountNumber"
                  />
                  <Input
                    defaultValue={profile.cashApprovalThreshold}
                    hint="Cash above this needs a second person to approve it. 0 means every cash entry does."
                    label="Cash second-approval threshold (NPR)"
                    min="0"
                    name="cashApprovalThreshold"
                    required
                    type="number"
                  />
                </div>
                <TextArea
                  defaultValue={profile.paymentInstructions ?? ""}
                  label="Instructions for residents — shown under the QR, e.g. “write your room number in the remarks”"
                  name="paymentInstructions"
                />
                <div className="flex justify-end">
                  <button
                    className="rounded-md bg-role-admin px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                    disabled={saving}
                    type="submit"
                  >
                    {saving ? "Saving…" : "Save payment details"}
                  </button>
                </div>
              </form>
            </Panel>
          </>
        ) : null}
      </div>
    );
  },
);
