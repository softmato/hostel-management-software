"use client";

import { Home, ImagePlus, Loader2, Trash2 } from "lucide-react";
import {
  memo,
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { EmptyState, Input, Panel, Select, TextArea } from "@/app/_components/shared-ui";
import { useMediaViewer } from "@/components/media-viewer";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/browser-api";
import { photosOfKind } from "@/lib/hostel-photos";
import { acceptAttribute } from "@/lib/uploads/accepts";
import { uploadFiles } from "@/lib/uploads/uploader";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { usePortalResource } from "@/lib/portal-query";
import {
  csvField,
  DemoDataBadge,
  field,
  Hostel,
  Message,
  numberField,
  optionalField,
  PageHeader,
} from "./core-portal-shared";

const NAME_CHANGE_LIMIT = 2;
const PHOTO_LIMITS = { EXTERIOR: 3, INTERIOR: 20 } as const;

/**
 * A file the admin just picked, rendered from a local object URL so the grid
 * fills in on click. It blurs under a spinner until its upload lands.
 */
type PendingPhoto = {
  id: string;
  previewUrl: string;
  uploaded?: boolean;
};

export const HostelAdminProfilePageContent = memo(function HostelAdminProfilePageContent() {
  const [actionMessage, setActionMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<"" | "EXTERIOR" | "INTERIOR">("");
  const [pendingByKind, setPendingByKind] = useState<Record<string, PendingPhoto[]>>({});
  // Photos whose delete is in flight — mirrored on the upload treatment, so a
  // removal blurs under a spinner instead of sitting crisp until the round trip.
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const { open: openViewer } = useMediaViewer();
  const [sendingRequest, setSendingRequest] = useState(false);

  // Same cache entry as the Rooms & Beds and Fee Plans screens.
  const profileResource = usePortalResource<{ hostel: Hostel }>(
    hostelAdminEndpoints.profile,
    { errorMessage: "Could not load profile." },
  );

  const hostel = profileResource.data?.hostel ?? null;
  const message = actionMessage || profileResource.message;
  const { refreshAsync: reloadProfile } = profileResource;

  const nameLocked = useMemo(
    () =>
      hostel != null &&
      ["APPROVED", "PUBLISHED"].includes(hostel.status ?? "") &&
      (hostel.nameChangeCount ?? 0) >= NAME_CHANGE_LIMIT,
    [hostel],
  );

  // ROOM photos belong to a room type and are managed on the Rooms & Beds
  // screen, so they stay out of both grids here.
  const photosByKind = useMemo(
    () => ({
      EXTERIOR: photosOfKind(hostel?.photos, "EXTERIOR"),
      INTERIOR: photosOfKind(hostel?.photos, "INTERIOR"),
    }),
    [hostel],
  );

  const uploadPhotos = useCallback(
    async (
      event: ChangeEvent<HTMLInputElement>,
      kind: "EXTERIOR" | "INTERIOR",
      freeSlots: number,
    ) => {
      const chosen = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (chosen.length === 0) return;

      // Trim to what still fits rather than letting the server reject the tail
      // of the batch one 422 at a time.
      const files = chosen.slice(0, freeSlots);
      const skipped = chosen.length - files.length;
      const noun = kind === "EXTERIOR" ? "Exterior" : "Interior";

      // Show the picked files straight away, blurred under a spinner, so the
      // grid reacts to the click instead of to the round trip.
      const pending: PendingPhoto[] = files.map((file) => ({
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
      }));

      setPendingByKind((prev) => ({ ...prev, [kind]: pending }));
      setUploadingKind(kind);
      try {
        let added = 0;

        // One file at a time so each preview sharpens as its own upload lands,
        // rather than the whole batch clearing at once. uploadFiles registers
        // every file with the global upload store, so the always-mounted
        // toaster still shows byte-level progress.
        for (const [index, file] of files.entries()) {
          const [outcome] = await uploadFiles([file], {
            accessLevel: "PUBLIC",
            kind: "image",
            label: `${noun} photo`,
            scope: `hostel-photos:${kind}`,
            // Failures already toast; the summary below covers the successes.
            silent: true,
          });

          if (!outcome?.ok || !outcome.result.assetId) {
            // A file that failed should stop pretending it is on its way.
            setPendingByKind((prev) => ({
              ...prev,
              [kind]: (prev[kind] ?? []).filter(
                (item) => item.id !== pending[index].id,
              ),
            }));
            URL.revokeObjectURL(pending[index].previewUrl);
            continue;
          }

          await browserApi(`${hostelAdminEndpoints.profile}/photos`, {
            body: JSON.stringify({
              fileAssetId: outcome.result.assetId,
              kind,
              url: `${window.location.origin}/api/v1/files/${outcome.result.assetId}/url`,
            }),
            method: "POST",
          });
          added += 1;

          // Drop the blur — this one is stored, even though the refreshed list
          // has not come back yet.
          setPendingByKind((prev) => ({
            ...prev,
            [kind]: (prev[kind] ?? []).map((item) =>
              item.id === pending[index].id ? { ...item, uploaded: true } : item,
            ),
          }));
        }

        setActionMessage(
          [
            added > 0
              ? `Added ${added} ${noun.toLowerCase()} photo(s).`
              : `No ${noun.toLowerCase()} photos were added.`,
            skipped > 0
              ? `${skipped} skipped — at most ${PHOTO_LIMITS[kind]} ${noun.toLowerCase()} photo(s).`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
        await reloadProfile();
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Could not upload photos.");
      } finally {
        // The stored photos are on screen now, so the local previews can go.
        setPendingByKind((prev) => {
          const next = { ...prev };
          delete next[kind];
          return next;
        });
        for (const item of pending) {
          URL.revokeObjectURL(item.previewUrl);
        }
        setUploadingKind("");
      }
    },
    [reloadProfile],
  );

  const deletePhoto = useCallback(
    async (photoId?: string) => {
      if (!photoId) return;
      setDeletingIds((prev) => (prev.includes(photoId) ? prev : [...prev, photoId]));
      try {
        await browserApi(`${hostelAdminEndpoints.profile}/photos/${photoId}`, {
          method: "DELETE",
        });
        setActionMessage("Photo removed.");
        await reloadProfile();
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Could not remove photo.");
      } finally {
        // The refreshed list has dropped it by now; a failed delete gets its
        // photo back sharp and clickable.
        setDeletingIds((prev) => prev.filter((id) => id !== photoId));
      }
    },
    [reloadProfile],
  );

  const sendChangeRequest = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);

      setSendingRequest(true);
      try {
        await browserApi(`${hostelAdminEndpoints.profile}/change-request`, {
          body: JSON.stringify({
            changeType: field(form, "changeType"),
            reason: optionalField(form, "reason"),
            requestedValue: field(form, "requestedValue"),
          }),
          method: "POST",
        });
        formElement.reset();
        setActionMessage(
          "Change request sent to the platform team. You'll get an email once it's applied.",
        );
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "Could not send the change request.",
        );
      } finally {
        setSendingRequest(false);
      }
    },
    [],
  );

  const save = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);

      setSaving(true);
      try {
        await browserApi(hostelAdminEndpoints.profile, {
          body: JSON.stringify({
            contact: {
              email: optionalField(form, "email"),
              phone: optionalField(form, "phone"),
            },
            description: optionalField(form, "description"),
            facilities: csvField(form, "facilities"),
            food: {
              hasNonVeg: form.get("hasNonVeg") === "on",
              hasVeg: form.get("hasVeg") === "on",
              mealsPerDay: numberField(form, "mealsPerDay"),
              notes: optionalField(form, "foodNotes"),
            },
            hostelType: field(form, "hostelType"),
            location: {
              address: optionalField(form, "address"),
              area: field(form, "area"),
              city: field(form, "city"),
            },
            ...(nameLocked ? {} : { name: field(form, "name") }),
            pricing: {
              monthlyRentMax: numberField(form, "monthlyRentMax"),
              monthlyRentMin: numberField(form, "monthlyRentMin"),
            },
            roomTypes: csvField(form, "roomTypes"),
            rules: csvField(form, "rules"),
            totalFloors: numberField(form, "totalFloors"),
          }),
          method: "PATCH",
        });
        setActionMessage("Profile saved.");
        await reloadProfile();
      } catch (error) {
        setActionMessage(error instanceof Error ? error.message : "Could not save profile.");
      } finally {
        setSaving(false);
      }
    },
    [nameLocked, reloadProfile],
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PageHeader
        description="Real hostel listing fields stored in MongoDB and shown publicly after approval."
        icon={Home}
        title="Hostel Profile"
      />
      <Message value={message} />
      {hostel ? (
        <Panel title="Profile Details">
          {hostel.isDemoData ? (
            <div className="mb-4">
              <DemoDataBadge label={hostel.demoDataLabel} />
            </div>
          ) : null}
          <form className="grid gap-4" key={hostel.id} onSubmit={save}>
            <div className="grid gap-4 md:grid-cols-2">
              {nameLocked ? (
                <div className="grid gap-2 text-sm font-semibold text-foreground">
                  Name
                  <p className="flex h-11 items-center rounded-md border border-border bg-muted/40 px-3 text-sm font-normal text-muted-foreground">
                    {hostel.name} (locked — use a change request below)
                  </p>
                </div>
              ) : (
                <div className="grid gap-1">
                  <Input defaultValue={hostel.name} label="Name" name="name" required />
                  {["APPROVED", "PUBLISHED"].includes(hostel.status ?? "") ? (
                    <p className="text-xs text-muted-foreground">
                      {NAME_CHANGE_LIMIT - (hostel.nameChangeCount ?? 0)} name change(s)
                      left after approval.
                    </p>
                  ) : null}
                </div>
              )}
              <div className="grid gap-1">
                <Input
                  defaultValue={hostel.totalFloors ?? 0}
                  label="Number of floors"
                  min="0"
                  name="totalFloors"
                  type="number"
                />
                <p className="text-xs text-muted-foreground">
                  Building detail only — rooms are managed as one list.
                </p>
              </div>
              <Select
                defaultValue={hostel.hostelType}
                label="Type"
                name="hostelType"
                required
              >
                {["BOYS", "GIRLS", "CO_LIVING"].map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
              <Input
                defaultValue={hostel.location.area}
                label="Area"
                name="area"
                required
              />
              <Input
                defaultValue={hostel.location.city}
                label="City"
                name="city"
                required
              />
              <Input
                defaultValue={hostel.location.address}
                label="Address"
                name="address"
              />
              <Input defaultValue={hostel.contact?.phone} label="Phone" name="phone" />
              <Input
                defaultValue={hostel.contact?.email}
                label="Email"
                name="email"
                type="email"
              />
              <Input
                defaultValue={hostel.roomTypes.join(", ")}
                label="Room types (comma separated)"
                name="roomTypes"
              />
              <Input
                defaultValue={hostel.facilities.join(", ")}
                label="Facilities (comma separated)"
                name="facilities"
              />
              <Input
                defaultValue={hostel.rules.join(", ")}
                label="Rules (comma separated)"
                name="rules"
              />
              <Input
                defaultValue={hostel.pricing?.monthlyRentMin}
                label="Monthly rent min"
                name="monthlyRentMin"
                type="number"
              />
              <Input
                defaultValue={hostel.pricing?.monthlyRentMax}
                label="Monthly rent max"
                name="monthlyRentMax"
                type="number"
              />
              <Input
                defaultValue={hostel.food?.mealsPerDay}
                label="Meals per day"
                name="mealsPerDay"
                type="number"
              />
            </div>
            <TextArea
              defaultValue={hostel.description}
              label="Description"
              name="description"
            />
            <TextArea
              defaultValue={hostel.food?.notes}
              label="Food notes"
              name="foodNotes"
            />
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  defaultChecked={hostel.food?.hasVeg ?? true}
                  name="hasVeg"
                  type="checkbox"
                />
                Veg
              </label>
              <label className="flex items-center gap-2">
                <input
                  defaultChecked={hostel.food?.hasNonVeg ?? true}
                  name="hasNonVeg"
                  type="checkbox"
                />
                Non-veg
              </label>
            </div>
            <Button
              className="h-11 bg-role-admin text-sm font-semibold text-white hover:bg-role-admin/85"
              loading={saving}
              type="submit"
            >
              Save Profile
            </Button>
          </form>
        </Panel>
      ) : (
        <EmptyState label="Profile is not loaded." />
      )}

      {hostel ? (
        <Panel title="Hostel Overview">
          <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Status", hostel.status ?? "—"],
              ["Slug", hostel.slug ?? "—"],
              ["Type", hostel.hostelType ?? "—"],
              [
                "Location",
                [hostel.location?.address, hostel.location?.area, hostel.location?.city]
                  .filter(Boolean)
                  .join(", ") || "—",
              ],
              ["Phone", hostel.contact?.phone || "—"],
              ["Email", hostel.contact?.email || "—"],
              ["Floors", String(hostel.totalFloors ?? 0)],
              ["Total rooms", String(hostel.capacitySummary?.totalRooms ?? 0)],
              ["Total beds", String(hostel.capacitySummary?.totalBeds ?? 0)],
              ["Vacant beds", String(hostel.capacitySummary?.vacantBeds ?? 0)],
              [
                "Name changes used",
                `${hostel.nameChangeCount ?? 0} of ${NAME_CHANGE_LIMIT}`,
              ],
              ["Facilities", hostel.facilities.join(", ") || "—"],
              ["Room types", hostel.roomTypes.join(", ") || "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="font-semibold text-muted-foreground">{label}</dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            The address above powers the public map, and saving a new address
            automatically refreshes the nearby colleges, parks, gyms and
            restaurants shown on your public listing.
          </p>
        </Panel>
      ) : null}

      {hostel ? (
        <Panel title="Hostel Photos">
          <p className="mb-4 text-sm text-muted-foreground">
            These photos appear on your public listing. Exterior photos (max{" "}
            {PHOTO_LIMITS.EXTERIOR}) are shown first; interior photos (max{" "}
            {PHOTO_LIMITS.INTERIOR}) fill the gallery.
          </p>
          {(
            [
              ["EXTERIOR", "Exterior / main photos"],
              ["INTERIOR", "Interior photos"],
            ] as const
          ).map(([kind, title]) => {
            const pending = pendingByKind[kind] ?? [];
            // Previews count against the limit while they are in flight.
            const used = photosByKind[kind].length + pending.length;

            return (
            <div className="mb-6 last:mb-0" key={kind}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  {title} ({used}/{PHOTO_LIMITS[kind]})
                </h3>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-role-admin px-3 py-1.5 text-xs font-semibold text-role-admin transition hover:bg-role-admin/10">
                  <ImagePlus className="size-4" />
                  {uploadingKind === kind ? "Uploading..." : "Add photos"}
                  <input
                    accept={acceptAttribute("image")}
                    className="hidden"
                    disabled={uploadingKind !== "" || used >= PHOTO_LIMITS[kind]}
                    multiple
                    onChange={(event) =>
                      void uploadPhotos(event, kind, PHOTO_LIMITS[kind] - used)
                    }
                    type="file"
                  />
                </label>
              </div>
              {used === 0 ? (
                <p className="text-sm text-muted-foreground">No photos yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {photosByKind[kind].map((photo, photoIndex) => {
                    const deleting = photo.id != null && deletingIds.includes(photo.id);

                    return (
                    <div className="group relative" key={photo.id ?? photo.url}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={photo.alt || "Hostel photo"}
                        className={
                          deleting
                            ? "h-28 w-full rounded-lg border border-border object-cover blur-[2px] brightness-90 transition"
                            : "h-28 w-full cursor-zoom-in rounded-lg border border-border object-cover transition"
                        }
                        onClick={() =>
                          deleting
                            ? undefined
                            : openViewer(
                                photosByKind[kind].map((item) => ({
                                  src: item.url ?? "",
                                  title,
                                })),
                                photoIndex,
                              )
                        }
                        src={photo.url}
                      />
                      {deleting ? (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/25">
                          <Loader2 className="size-6 animate-spin text-white" />
                        </div>
                      ) : (
                        <Button
                          className="absolute right-1.5 top-1.5 size-7 opacity-0 transition group-hover:opacity-100"
                          onClick={() => void deletePhoto(photo.id)}
                          size="icon"
                          type="button"
                          variant="destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                    );
                  })}
                  {pending.map((item) => (
                    <div className="relative" key={item.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt=""
                        className={
                          item.uploaded
                            ? "h-28 w-full rounded-lg border border-border object-cover transition"
                            : "h-28 w-full rounded-lg border border-border object-cover blur-[2px] brightness-90 transition"
                        }
                        src={item.previewUrl}
                      />
                      {item.uploaded ? null : (
                        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/25">
                          <Loader2 className="size-6 animate-spin text-white" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </Panel>
      ) : null}

      {hostel ? (
        <Panel title="Request a Locked Change">
          <p className="mb-3 text-sm text-muted-foreground">
            Extra hostel-name changes, owner-name changes and account-email changes
            are verified by the platform team. Send a request and you&apos;ll receive
            an acknowledgement email once it&apos;s applied.
          </p>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={sendChangeRequest}>
            <Select label="What do you want to change?" name="changeType" required>
              <option value="HOSTEL_NAME">Hostel name</option>
              <option value="OWNER_NAME">Owner name</option>
              <option value="OWNER_EMAIL">Owner account email</option>
            </Select>
            <Input label="New value" name="requestedValue" required />
            <div className="md:col-span-2">
              <TextArea label="Reason (optional)" name="reason" />
            </div>
            <div className="md:col-span-2">
              <Button
                className="h-11 bg-role-admin text-sm font-semibold text-white hover:bg-role-admin/85"
                loading={sendingRequest}
                type="submit"
              >
                Send Request
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}
    </div>
  );
});
