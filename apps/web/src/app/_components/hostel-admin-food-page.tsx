"use client";

import {
  CalendarDays,
  ChefHat,
  ChevronDown,
  Cookie,
  Moon,
  Pencil,
  Plus,
  Sparkles,
  Sun,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { memo, useCallback, useMemo, useState, type FormEvent } from "react";

import {
  EmptyState,
  Input,
  LoadingRows,
  Panel,
  StatusBadge,
} from "@/app/_components/shared-ui";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/browser-api";
import { hostelAdminEndpoints } from "@/lib/hostel-admin-endpoints";
import { useInvalidateResources, usePortalResource } from "@/lib/portal-query";
import { cn } from "@/lib/utils";

import { field, optionalField, PageHeader, type FoodMenu } from "./hostel-admin-shared";

type CookPortalSettings = {
  cookEmail: string;
  cookName: string;
  cookPortalEnabled: boolean;
  credentialIssuedAt?: string;
  initialPasswordPending: boolean;
};

type MealType = FoodMenu["mealType"];
type RoutineTab = "month-end" | "special" | "weekly";

const COOK_PORTAL_DEFAULTS: CookPortalSettings = {
  cookEmail: "",
  cookName: "",
  cookPortalEnabled: false,
  initialPasswordPending: false,
};

/** Sunday-first: Nepal's week starts on Sunday. */
const DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

const MEALS: { defaultTiming: string; icon: LucideIcon; label: string; type: MealType }[] =
  [
    {
      defaultTiming: "6:00 AM - 7:00 AM",
      icon: Sun,
      label: "Breakfast (Morning)",
      type: "BREAKFAST",
    },
    {
      defaultTiming: "8:45 AM - 12:00 PM",
      icon: Utensils,
      label: "Lunch",
      type: "LUNCH",
    },
    {
      defaultTiming: "3:00 PM - 5:00 PM",
      icon: Cookie,
      label: "Evening Snacks",
      type: "SNACKS",
    },
    {
      defaultTiming: "7:00 PM - 8:45 PM",
      icon: Moon,
      label: "Dinner",
      type: "DINNER",
    },
  ];

const TABS: { icon: LucideIcon; id: RoutineTab; label: string }[] = [
  { icon: CalendarDays, id: "weekly", label: "Weekly Routine" },
  { icon: Sparkles, id: "special", label: "Special Foods" },
  { icon: ChefHat, id: "month-end", label: "Month End Specials" },
];

function startOfWeek(value: Date) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());

  // getDay() is already Sunday-based, which is the week start we want.
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);

  date.setDate(date.getDate() + days);
  return date;
}

/** `YYYY-MM-DD` in local time — `toISOString()` would shift the day in +/- zones. */
function toDateKey(value: Date) {
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");

  return `${value.getFullYear()}-${month}-${day}`;
}

function formatWeekRange(weekStart: Date) {
  const weekEnd = addDays(weekStart, 6);
  const start = weekStart.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
  const end = weekEnd.toLocaleDateString(undefined, { day: "numeric", month: "short" });

  return `${start} – ${end}, ${weekEnd.getFullYear()}`;
}

function isLastDayOfMonth(value: Date) {
  return addDays(value, 1).getDate() === 1;
}

/** Day 0 of the next month rolls back to the last day of this one. */
function lastDayOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0);
}

function writtenAt(menu: FoodMenu) {
  return new Date(menu.updatedAt ?? menu.createdAt ?? 0).getTime();
}

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export const HostelAdminFoodPage = memo(function HostelAdminFoodPage() {
  const [actionMessage, setActionMessage] = useState("");
  const [busyForm, setBusyForm] = useState<"" | "cook" | "routine">("");
  const [tab, setTab] = useState<RoutineTab>("weekly");
  const [isEditing, setIsEditing] = useState(false);
  const [showCookPortal, setShowCookPortal] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const invalidate = useInvalidateResources();

  const weekStart = useMemo(
    () => addDays(startOfWeek(new Date()), weekOffset * 7),
    [weekOffset],
  );
  const weekDays = useMemo(
    () => DAYS.map((day, index) => ({ date: addDays(weekStart, index), day })),
    [weekStart],
  );
  // Read the whole month (or both months, when a week straddles them) the
  // selected week sits in: the week grid needs seven days, and the specials
  // tabs are scoped to that same span.
  const range = useMemo(() => {
    const weekEnd = addDays(weekStart, 6);

    return {
      from: toDateKey(new Date(weekStart.getFullYear(), weekStart.getMonth(), 1)),
      to: toDateKey(lastDayOfMonth(weekEnd)),
    };
  }, [weekStart]);

  const menusResource = usePortalResource<{ menus: FoodMenu[] }>(
    `${hostelAdminEndpoints.foodMenu}?from=${range.from}&to=${range.to}`,
    { errorMessage: "Could not load food menus." },
  );
  // Non-critical panel: its own errors stay off the page banner, so a failed
  // read just leaves the toggle in its default (disabled) state.
  const cookPortalResource = usePortalResource<{ settings: CookPortalSettings }>(
    hostelAdminEndpoints.cookPortal,
  );

  const menus = useMemo(() => menusResource.data?.menus ?? [], [menusResource.data]);
  const state = menusResource.state;
  const message = actionMessage || menusResource.message;
  const cookPortal = cookPortalResource.data?.settings ?? COOK_PORTAL_DEFAULTS;

  // (day, meal) -> menu, so the grid and the editor can both read a cell by key.
  // Older rows can still collide on a cell (same day and meal, different stored
  // time), so the most recently written one wins rather than the last one read.
  const weekCells = useMemo(() => {
    const keys = new Set(weekDays.map((entry) => toDateKey(entry.date)));
    const cells = new Map<string, FoodMenu>();

    for (const menu of menus) {
      const dateKey = toDateKey(new Date(menu.date));

      if (!keys.has(dateKey)) {
        continue;
      }

      const cellKey = `${dateKey}:${menu.mealType}`;
      const current = cells.get(cellKey);

      if (!current || writtenAt(menu) >= writtenAt(current)) {
        cells.set(cellKey, menu);
      }
    }

    return cells;
  }, [menus, weekDays]);

  const specialMenus = useMemo(
    () => menus.filter((menu) => Boolean(menu.specialNotes)),
    [menus],
  );
  const monthEndMenus = useMemo(
    () => menus.filter((menu) => isLastDayOfMonth(new Date(menu.date))),
    [menus],
  );

  const hasRoutine = weekCells.size > 0;

  // The month-end special is just the routine's dinner on the last day of the
  // month the week sits in — no separate model, so the editor writes it there.
  const monthEndDate = useMemo(() => lastDayOfMonth(weekStart), [weekStart]);
  const monthEndCell = useMemo(() => {
    const dateKey = toDateKey(monthEndDate);

    return menus
      .filter(
        (menu) =>
          toDateKey(new Date(menu.date)) === dateKey && menu.mealType === "DINNER",
      )
      .sort((left, right) => writtenAt(right) - writtenAt(left))[0];
  }, [menus, monthEndDate]);

  // Held in memory only, never persisted: shown once right after issuing.
  const [cookPassword, setCookPassword] = useState("");

  const submitCookPortal = useCallback(
    async (enabled: boolean, cookName?: string, rotate = false) => {
      setBusyForm("cook");
      try {
        const result = await browserApi<{
          credentials?: { email: string; temporaryPassword: string };
          settings: CookPortalSettings;
        }>(hostelAdminEndpoints.cookPortal, {
          body: JSON.stringify({ cookName, enabled }),
          method: "PATCH",
        });

        invalidate(hostelAdminEndpoints.cookPortal);
        setCookPassword(result.credentials?.temporaryPassword ?? "");
        setActionMessage(
          result.credentials
            ? `${rotate ? "New cook password issued" : "Cook portal enabled"} — also emailed to you. Any previous password no longer works.`
            : "Cook portal disabled.",
        );
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "Could not update the cook portal.",
        );
      } finally {
        setBusyForm("");
      }
    },
    [invalidate],
  );

  const handleCookPortal = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);

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

  // One submit writes the whole week: every filled cell is POSTed, and the API
  // upserts on (hostel, date, meal) so re-saving edits instead of duplicating.
  const handleSaveRoutine = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formElement = event.currentTarget;
      const form = new FormData(formElement);
      const weekStartDate = toDateKey(weekStart);
      const payloads = [];

      for (const { date, day } of weekDays) {
        const dateKey = toDateKey(date);

        for (const meal of MEALS) {
          const items = form
            .get(`items:${dateKey}:${meal.type}`)
            ?.toString()
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);

          if (!items?.length) {
            continue;
          }

          payloads.push({
            date: dateKey,
            dayOfWeek: day,
            items,
            mealType: meal.type,
            specialNotes: optionalField(form, `notes:${dateKey}:${meal.type}`),
            timing: field(form, `timing:${meal.type}`),
            weekStartDate,
          });
        }
      }

      const monthEndItems = form
        .get("monthEndItems")
        ?.toString()
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      if (monthEndItems?.length) {
        const monthEndKey = toDateKey(monthEndDate);

        payloads.push({
          date: monthEndKey,
          dayOfWeek: DAYS[monthEndDate.getDay()],
          items: monthEndItems,
          mealType: "DINNER" as MealType,
          specialNotes: optionalField(form, "monthEndNotes"),
          timing: field(form, "timing:DINNER"),
          weekStartDate: toDateKey(startOfWeek(monthEndDate)),
        });
      }

      if (payloads.length === 0) {
        setActionMessage("Add at least one meal before saving the routine.");
        return;
      }

      setBusyForm("routine");
      try {
        for (const payload of payloads) {
          await browserApi(hostelAdminEndpoints.foodMenu, {
            body: JSON.stringify(payload),
            method: "POST",
          });
        }

        setActionMessage(`Food routine saved for ${formatWeekRange(weekStart)}.`);
        setIsEditing(false);
        // Every week reads its own ranged url, so drop the whole family.
        invalidate(`${hostelAdminEndpoints.foodMenu}*`);
      } catch (error) {
        setActionMessage(
          error instanceof Error ? error.message : "Could not save the food routine.",
        );
      } finally {
        setBusyForm("");
      }
    },
    [invalidate, monthEndDate, weekDays, weekStart],
  );

  const weekPicker = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground">
        <CalendarDays className="size-4 text-role-admin" />
        <span className="sr-only">Week</span>
        <select
          className="bg-transparent text-sm font-semibold outline-none"
          onChange={(event) => setWeekOffset(Number(event.target.value))}
          value={weekOffset}
        >
          {Array.from({ length: 13 }, (_, index) => index - 6).map((offset) => (
            <option key={offset} value={offset}>
              {formatWeekRange(addDays(startOfWeek(new Date()), offset * 7))}
            </option>
          ))}
        </select>
      </label>
      <button
        className="h-11 rounded-md border border-border px-4 text-sm font-semibold text-foreground hover:bg-muted/50"
        onClick={() => setWeekOffset(0)}
        type="button"
      >
        This Week
      </button>
      {hasRoutine && !isEditing ? (
        <button
          className="flex h-11 items-center gap-2 rounded-md border border-role-admin px-4 text-sm font-semibold text-role-admin hover:bg-role-admin/10"
          onClick={() => setIsEditing(true)}
          type="button"
        >
          <Pencil className="size-4" />
          Edit Routine
        </button>
      ) : null}
    </div>
  );

  function renderRoutineCard() {
    if (state === "loading") {
      return (
        <Panel>
          <LoadingRows />
        </Panel>
      );
    }

    if (state === "error") {
      return (
        <Panel>
          <EmptyState label="Menus could not be loaded." />
        </Panel>
      );
    }

    // Phase 3 — the configure/edit flow replaces the card entirely.
    if (isEditing) {
      return (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-lg font-bold text-foreground">
                Configure Food Routine
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatWeekRange(weekStart)} · leave a meal blank to skip it.
              </p>
            </div>
            {weekPicker}
          </div>
          <form className="mt-5 grid gap-5" onSubmit={handleSaveRoutine}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {MEALS.map((meal) => {
                const existing = weekDays
                  .map((entry) => weekCells.get(`${toDateKey(entry.date)}:${meal.type}`))
                  .find(Boolean);

                return (
                  <Input
                    defaultValue={existing?.timing ?? meal.defaultTiming}
                    key={meal.type}
                    label={`${meal.label} timing`}
                    name={`timing:${meal.type}`}
                    required
                  />
                );
              })}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    <th className="w-32 px-4 py-3 font-semibold text-foreground">Day</th>
                    {MEALS.map((meal) => (
                      <th
                        className="px-4 py-3 font-semibold text-foreground"
                        key={meal.type}
                      >
                        <span className="flex items-center gap-2">
                          <meal.icon className="size-4 text-role-admin" />
                          {meal.label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weekDays.map(({ date, day }) => {
                    const dateKey = toDateKey(date);

                    return (
                      <tr className="border-t border-border align-top" key={day}>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-foreground">
                            {titleCase(day)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {date.toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                            })}
                          </p>
                        </td>
                        {MEALS.map((meal) => {
                          const cell = weekCells.get(`${dateKey}:${meal.type}`);

                          return (
                            <td className="px-3 py-3" key={meal.type}>
                              <input
                                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-role-admin"
                                defaultValue={cell?.items.join(", ") ?? ""}
                                name={`items:${dateKey}:${meal.type}`}
                                placeholder="Comma separated items"
                              />
                              <input
                                className="mt-2 h-9 w-full rounded-md border border-dashed border-border bg-background px-3 text-xs outline-none focus:border-role-admin"
                                defaultValue={cell?.specialNotes ?? ""}
                                name={`notes:${dateKey}:${meal.type}`}
                                placeholder="Special note (optional)"
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4">
              <div>
                <p className="font-heading text-sm font-bold text-foreground">
                  Month End Special
                </p>
                <p className="text-xs text-muted-foreground">
                  Served on {monthEndDate.toLocaleDateString()} in place of that
                  night&apos;s dinner.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-role-admin"
                  defaultValue={monthEndCell?.items.join(", ") ?? ""}
                  name="monthEndItems"
                  placeholder="Comma separated items"
                />
                <input
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-role-admin"
                  defaultValue={monthEndCell?.specialNotes ?? ""}
                  name="monthEndNotes"
                  placeholder="Note (optional)"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                className="h-11 bg-role-admin px-6 text-sm font-semibold text-white hover:bg-role-admin/85"
                loading={busyForm === "routine"}
                type="submit"
              >
                Save Food Routine
              </Button>
              <button
                className="h-11 rounded-md border border-border px-6 text-sm font-semibold text-foreground hover:bg-muted/50"
                onClick={() => setIsEditing(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        </Panel>
      );
    }

    // Phase 1 — nothing configured for this week yet.
    if (!hasRoutine) {
      return (
        <Panel>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-heading text-lg font-bold text-foreground">
                Food &amp; Menu
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Plan and manage the weekly food routine for residents.
              </p>
            </div>
            {weekPicker}
          </div>
          <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-14 text-center">
            <span className="rounded-full bg-role-admin-soft p-4 text-role-admin">
              <ChefHat className="size-8" />
            </span>
            <p className="font-heading text-lg font-bold text-foreground">
              No food routine configured
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              It looks like you haven&apos;t set up any food routine for{" "}
              {formatWeekRange(weekStart)} yet.
            </p>
            <Button
              className="mt-2 h-11 bg-role-admin px-6 text-sm font-semibold text-white hover:bg-role-admin/85"
              onClick={() => setIsEditing(true)}
              type="button"
            >
              <Plus className="size-4" />
              Configure Food Routine
            </Button>
          </div>
        </Panel>
      );
    }

    // Phase 2 — the configured routine, split across the three tabs.
    return (
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-lg font-bold text-foreground">
              Food &amp; Menu
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Plan and manage the weekly food routine for residents.
            </p>
          </div>
          {weekPicker}
        </div>

        <div className="mt-5 flex gap-6 border-b border-border">
          {TABS.map((entry) => (
            <button
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 pb-3 text-sm font-semibold",
                tab === entry.id
                  ? "border-role-admin text-role-admin"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              key={entry.id}
              onClick={() => setTab(entry.id)}
              type="button"
            >
              <entry.icon className="size-4" />
              {entry.label}
            </button>
          ))}
        </div>

        {tab === "weekly" ? (
          <div className="mt-5 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="w-40 px-4 py-3 font-semibold text-foreground">Day</th>
                  {MEALS.map((meal) => (
                    <th
                      className="px-4 py-3 font-semibold text-foreground"
                      key={meal.type}
                    >
                      <span className="flex items-center gap-2">
                        <meal.icon className="size-4 text-role-admin" />
                        {meal.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekDays.map(({ date, day }) => {
                  const dateKey = toDateKey(date);

                  return (
                    <tr className="border-t border-border align-top" key={day}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-foreground">{titleCase(day)}</p>
                        <p className="text-xs text-muted-foreground">
                          {date.toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                          })}
                        </p>
                      </td>
                      {MEALS.map((meal) => {
                        const cell = weekCells.get(`${dateKey}:${meal.type}`);

                        return (
                          <td className="px-4 py-3 text-foreground" key={meal.type}>
                            {cell ? (
                              <>
                                <span>{cell.items.join(", ")}</span>
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  {cell.timing}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === "special" ? (
          <div className="mt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-heading text-sm font-bold text-foreground">
                  Special Foods
                </p>
                <p className="text-xs text-muted-foreground">
                  Meals carrying a special note this month.
                </p>
              </div>
              <button
                className="flex h-10 items-center gap-2 rounded-md bg-role-admin px-4 text-sm font-semibold text-white hover:bg-role-admin/85"
                onClick={() => setIsEditing(true)}
                type="button"
              >
                <Plus className="size-4" />
                Add Item
              </button>
            </div>
            {specialMenus.length === 0 ? (
              <div className="mt-4">
                <EmptyState label="No special foods noted yet." />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left">
                      <th className="px-4 py-3 font-semibold text-foreground">
                        Food Item
                      </th>
                      <th className="px-4 py-3 font-semibold text-foreground">
                        Description / Notes
                      </th>
                      <th className="w-40 px-4 py-3 font-semibold text-foreground">
                        Served
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {specialMenus.map((menu) => (
                      <tr className="border-t border-border" key={menu.id}>
                        <td className="px-4 py-3 text-foreground">
                          {menu.items.join(", ")}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {menu.specialNotes}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge>{menu.mealType}</StatusBadge>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {new Date(menu.date).toLocaleDateString()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {tab === "month-end" ? (
          <div className="mt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-heading text-sm font-bold text-foreground">
                  Month End Specials
                </p>
                <p className="text-xs text-muted-foreground">
                  Menus configured for the last day of a month.
                </p>
              </div>
              <button
                className="flex h-10 items-center gap-2 rounded-md bg-role-admin px-4 text-sm font-semibold text-white hover:bg-role-admin/85"
                onClick={() => setIsEditing(true)}
                type="button"
              >
                <Plus className="size-4" />
                Add Item
              </button>
            </div>
            {monthEndMenus.length === 0 ? (
              <div className="mt-4">
                <EmptyState label="No month end specials configured." />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left">
                      <th className="w-44 px-4 py-3 font-semibold text-foreground">
                        Date
                      </th>
                      <th className="px-4 py-3 font-semibold text-foreground">
                        Special Menu
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthEndMenus.map((menu) => (
                      <tr className="border-t border-border" key={menu.id}>
                        <td className="px-4 py-3 text-foreground">
                          {new Date(menu.date).toLocaleDateString()}
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {menu.mealType.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-foreground">
                          {menu.items.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              These items are served on the last day of the month they are configured for.
            </p>
          </div>
        ) : null}
      </Panel>
    );
  }

  return (
    <div className="mx-auto max-w-[1448px] space-y-6">
      <PageHeader
        description="Plan and manage the weekly food routine for residents."
        icon={ChefHat}
        title="Food"
      />
      {message ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          {message}
        </div>
      ) : null}

      <Panel className="p-0">
        <button
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          onClick={() => setShowCookPortal((open) => !open)}
          type="button"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ChefHat className="size-4 text-role-admin" />
            See cook credentials
            {cookPortal.cookPortalEnabled ? null : (
              <span className="text-xs font-normal text-muted-foreground">
                (portal off)
              </span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              showCookPortal && "rotate-180",
            )}
          />
        </button>

        {showCookPortal ? (
          <form
            className="grid gap-3 border-t border-border p-4"
            onSubmit={handleCookPortal}
          >
            {cookPortal.cookPortalEnabled ? (
              <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="grid gap-0.5">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    Login
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
                  ) : (
                    <span className="text-muted-foreground">
                      {cookPortal.initialPasswordPending
                        ? "Emailed to you, not used yet."
                        : "Set by your cook, stored encrypted."}{" "}
                      Rotate to issue a new one.
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
              <>
                <p className="text-sm text-muted-foreground">
                  A shared kitchen login that can only announce meals.
                </p>
                <Input
                  defaultValue={cookPortal.cookName}
                  label="Cook name"
                  name="cookName"
                />
              </>
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                className="h-11 bg-role-admin px-5 text-sm font-semibold text-white hover:bg-role-admin/85"
                loading={busyForm === "cook"}
                type="submit"
              >
                {cookPortal.cookPortalEnabled ? "Disable" : "Enable Cook Portal"}
              </Button>
              {cookPortal.cookPortalEnabled ? (
                <button
                  className="h-11 rounded-md border border-border px-5 text-sm font-semibold text-foreground hover:bg-muted/50"
                  onClick={() => void handleRotateCookPassword()}
                  type="button"
                >
                  Rotate Password
                </button>
              ) : null}
            </div>
          </form>
        ) : null}
      </Panel>

      {renderRoutineCard()}
    </div>
  );
});
