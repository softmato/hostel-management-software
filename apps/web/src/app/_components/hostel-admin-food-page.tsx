"use client";

import { ChefHat, Upload } from "lucide-react";
import { memo, useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import {
  EmptyState,
  Input,
  LoadingRows,
  Panel,
  Select,
  StatusBadge,
  TextArea,
} from "@/app/_components/shared-ui";
import { browserApi } from "@/lib/browser-api";

import {
  field,
  optionalField,
  PageHeader,
  type FoodMenu,
  type LoadState,
} from "./hostel-admin-shared";

type CookPortalSettings = {
  cookEmail: string;
  cookName: string;
  cookPortalEnabled: boolean;
  credentialIssuedAt?: string;
  initialPasswordPending: boolean;
};

export const HostelAdminFoodPage = memo(function HostelAdminFoodPage() {
  const [menus, setMenus] = useState<FoodMenu[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [photoAssetId, setPhotoAssetId] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [cookPortal, setCookPortal] = useState<CookPortalSettings>({
    cookEmail: "",
    cookName: "",
    cookPortalEnabled: false,
    initialPasswordPending: false,
  });
  // Held in memory only, never persisted: shown once right after issuing.
  const [cookPassword, setCookPassword] = useState("");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const data = await browserApi<{ menus: FoodMenu[] }>(
        "/api/v1/hostel-admin/food/menu",
      );

      setMenus(data.menus);
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load food menus.");
      setState("error");
    }
  }, []);

  const loadCookPortal = useCallback(async () => {
    try {
      const data = await browserApi<{ settings: CookPortalSettings }>(
        "/api/v1/hostel-admin/cook-portal",
      );

      setCookPortal(data.settings);
    } catch {
      // Non-critical panel: leave the toggle in its default (disabled) state.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
      void loadCookPortal();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [load, loadCookPortal]);

  const submitCookPortal = useCallback(
    async (enabled: boolean, cookName?: string, rotate = false) => {
      try {
        const result = await browserApi<{
          credentials?: { email: string; temporaryPassword: string };
          settings: CookPortalSettings;
        }>("/api/v1/hostel-admin/cook-portal", {
          body: JSON.stringify({ cookName, enabled }),
          method: "PATCH",
        });

        setCookPortal(result.settings);
        setCookPassword(result.credentials?.temporaryPassword ?? "");
        setMessage(
          result.credentials
            ? `${rotate ? "New cook password issued" : "Cook portal enabled"} — also emailed to you. Any previous password no longer works.`
            : "Cook portal disabled.",
        );
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not update the cook portal.",
        );
      }
    },
    [],
  );

  const handleCookPortal = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      await submitCookPortal(
        !cookPortal.cookPortalEnabled,
        optionalField(form, "cookName"),
      );
    },
    [cookPortal.cookPortalEnabled, submitCookPortal],
  );

  // Rotating re-runs the enable path, which always issues a fresh password.
  const handleRotateCookPassword = useCallback(async () => {
    await submitCookPortal(true, undefined, true);
  }, [submitCookPortal]);

  const handleCreateMenu = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      try {
        await browserApi("/api/v1/hostel-admin/food/menu", {
          body: JSON.stringify({
            date: field(form, "date"),
            dayOfWeek: field(form, "dayOfWeek"),
            items: field(form, "items")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            mealType: field(form, "mealType"),
            specialNotes: optionalField(form, "specialNotes"),
            timing: field(form, "timing"),
            weekStartDate: field(form, "weekStartDate"),
          }),
          method: "POST",
        });
        event.currentTarget.reset();
        setMessage("Menu published.");
        await load();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not publish menu.");
      }
    },
    [load],
  );

  const handlePhotoFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const { uploadFile } = await import("@/lib/client-upload");
      const assetId = await uploadFile(file, "PRIVATE");
      setPhotoAssetId(assetId);
      setMessage("Food photo uploaded to storage.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload photo.");
    } finally {
      setUploadingPhoto(false);
    }
  }, []);

  const handlePhotoUpload = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      if (!photoAssetId) {
        setMessage("Please upload a photo first.");
        return;
      }

      try {
        await browserApi("/api/v1/hostel-admin/food/photos", {
          body: JSON.stringify({
            caption: optionalField(form, "caption"),
            date: field(form, "date"),
            mealType: field(form, "mealType"),
            photoAssetId,
          }),
          method: "POST",
        });
        event.currentTarget.reset();
        setPhotoAssetId("");
        setMessage("Food photo uploaded.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not upload photo.");
      }
    },
    [photoAssetId],
  );

  return (
    <div className="mx-auto max-w-[1448px] space-y-6">
      <PageHeader
        description="Publish weekly meal plans and daily food photos."
        icon={ChefHat}
        title="Food"
      />
      {message ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          {message}
        </div>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Panel title="Menus">
          {state === "loading" ? <LoadingRows /> : null}
          {state === "error" ? <EmptyState label="Menus could not be loaded." /> : null}
          {state === "ready" && menus.length === 0 ? (
            <EmptyState label="No menu items." />
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {menus.map((menu) => (
              <div className="rounded-lg border border-border p-4" key={menu.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">
                      {menu.mealType.replace("_", " ")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(menu.date).toLocaleDateString()} / {menu.timing}
                    </p>
                  </div>
                  <StatusBadge>{menu.dayOfWeek}</StatusBadge>
                </div>
                <p className="mt-3 text-sm text-foreground">{menu.items.join(", ")}</p>
                {menu.specialNotes ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {menu.specialNotes}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
        <div className="space-y-5">
          <Panel title="Cook Portal">
            <form className="grid gap-3" onSubmit={handleCookPortal}>
              <p className="text-sm text-muted-foreground">
                {cookPortal.cookPortalEnabled
                  ? `Enabled for ${cookPortal.cookName || "your cook"}. This is one shared kitchen login — it can only announce meals, never see payments, complaints, or resident contact details.`
                  : "Give your kitchen a shared mobile login so whoever is cooking can notify residents the moment food is ready."}
              </p>

              {cookPortal.cookPortalEnabled ? (
                <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <div className="grid gap-0.5">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      Cook login
                    </span>
                    <code className="break-all font-mono text-sm text-foreground">
                      {cookPortal.cookEmail || "—"}
                    </code>
                  </div>

                  <div className="grid gap-0.5">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      Password
                    </span>
                    {cookPassword ? (
                      <code className="break-all font-mono text-sm font-bold text-foreground">
                        {cookPassword}
                      </code>
                    ) : cookPortal.initialPasswordPending ? (
                      <span className="text-muted-foreground">
                        Emailed to you, and not used yet. Rotate below if you no longer
                        have it.
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Set by your cook — we only store it encrypted, so nobody can read
                        it back. Rotate below to issue a new one.
                      </span>
                    )}
                  </div>

                  {cookPortal.credentialIssuedAt ? (
                    <p className="text-xs text-muted-foreground">
                      Last issued{" "}
                      {new Date(cookPortal.credentialIssuedAt).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
              ) : (
                <Input
                  defaultValue={cookPortal.cookName}
                  label="Cook name"
                  name="cookName"
                />
              )}

              {cookPortal.cookPortalEnabled ? (
                <p className="text-sm text-muted-foreground">
                  The first cook to sign in sets a new password — that becomes the
                  kitchen&apos;s shared password. Rotate it whenever a cook leaves.
                </p>
              ) : null}
              <button className="h-11 rounded-md bg-role-admin text-sm font-semibold text-white">
                {cookPortal.cookPortalEnabled
                  ? "Disable Cook Portal"
                  : "Enable Cook Portal"}
              </button>
              {cookPortal.cookPortalEnabled ? (
                <button
                  className="h-11 rounded-md border border-border text-sm font-semibold text-foreground"
                  onClick={() => void handleRotateCookPassword()}
                  type="button"
                >
                  Rotate Cook Password
                </button>
              ) : null}
            </form>
          </Panel>
          <Panel title="Create Menu">
            <form className="grid gap-3" onSubmit={handleCreateMenu}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Date" name="date" required type="date" />
                <Input label="Week start" name="weekStartDate" required type="date" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Day" name="dayOfWeek" required>
                  {[
                    "SUNDAY",
                    "MONDAY",
                    "TUESDAY",
                    "WEDNESDAY",
                    "THURSDAY",
                    "FRIDAY",
                    "SATURDAY",
                  ].map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </Select>
                <Select label="Meal" name="mealType" required>
                  {["BREAKFAST", "LUNCH", "SNACKS", "DINNER"].map((meal) => (
                    <option key={meal} value={meal}>
                      {meal}
                    </option>
                  ))}
                </Select>
              </div>
              <Input label="Items" name="items" required />
              <Input label="Timing" name="timing" required />
              <TextArea label="Special notes" name="specialNotes" />
              <button className="h-11 rounded-md bg-role-admin text-sm font-semibold text-white">
                Publish Menu
              </button>
            </form>
          </Panel>
          <Panel title="Upload Photo">
            <form className="grid gap-3" onSubmit={handlePhotoUpload}>
              <div className="grid gap-2">
                <label className="text-sm font-semibold text-foreground">Photo</label>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm file:mr-3 file:h-8 file:rounded-md file:border-0 file:bg-role-admin file:px-3 file:text-xs file:font-semibold file:text-white"
                  disabled={uploadingPhoto}
                  onChange={handlePhotoFile}
                  required
                  type="file"
                />
                {uploadingPhoto ? (
                  <p className="text-xs text-muted-foreground">Uploading...</p>
                ) : photoAssetId ? (
                  <p className="text-xs text-emerald-600">Photo uploaded.</p>
                ) : null}
              </div>
              <input name="photoAssetId" type="hidden" value={photoAssetId} />
              <Input label="Date" name="date" required type="date" />
              <Select label="Meal" name="mealType" required>
                {["BREAKFAST", "LUNCH", "SNACKS", "DINNER"].map((meal) => (
                  <option key={meal} value={meal}>
                    {meal}
                  </option>
                ))}
              </Select>
              <Input label="Caption" name="caption" />
              <button
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-role-admin text-sm font-semibold text-role-admin disabled:opacity-50"
                disabled={uploadingPhoto || !photoAssetId}
                type="submit"
              >
                <Upload className="size-4" />
                Upload
              </button>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
});
