import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { DayStrip, MealCard } from "@/components/food-routine";
import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip, FactRow } from "@/components/ui/layout";
import { Screen } from "@/components/ui/screen";
import { Sheet } from "@/components/ui/sheet";
import { ErrorState, LoadingState, PermissionCard } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import { getAdminFoodRoutine } from "@/lib/admin-api";
import {
  type CookPortalSettings,
  getCookPortal,
  saveFoodRoutine,
  updateCookPortal,
} from "@/lib/admin-manage-api";
import { readApiError } from "@/lib/api-contract";
import { humanizeEnum } from "@/lib/format";
import { MEAL_TYPES, type MealType, ROUTINE_DAYS, type RoutineDay, todayInNepal } from "@/lib/food-week";
import type { FoodRoutine } from "@/lib/resident-api";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Food — editing the week, which is the half the app did not have.
 *
 * `(admin)/today.tsx` renders `FoodRoutineWeek` read-only and says so: "editing
 * the week's menu (a grid)" was on its list of things that wanted a desk. The
 * grid was the web's *layout*, not the feature. On a phone the same data is a
 * day at a time — seven days × four meals is 28 cells nobody can fill in one
 * sitting anyway, and the person editing it is usually fixing one of them.
 *
 * ## One document, one save
 *
 * `PUT /hostel-admin/food/routine` replaces the whole routine. There is no
 * per-cell write, so this screen holds a **draft** and only touches the network
 * when Save is pressed — which also means an accidental tap on the wrong day
 * costs nothing. The footer appears only when the draft differs from what was
 * loaded, so the screen is not permanently wearing a Save button.
 *
 * ## "Special foods" is not a thing to store
 *
 * The portal has a Special Foods tab; it lists the meals that carry a note.
 * That is a *view*, not data — the note lives on the meal — and on a phone the
 * note is already on the meal card you are looking at. So there is no third tab
 * here, and nothing is missing.
 *
 * ## The cook portal is on this screen because it is the same job
 *
 * The web puts it at the bottom of Food, and that is right: deciding what the
 * kitchen serves and deciding who is allowed to say it is ready are the same
 * person's decisions. Enabling it emails the cook a one-time password; nobody,
 * including this screen, can read that password back afterwards.
 */

const MEAL_HINTS: Record<MealType, string> = {
  BREAKFAST: "6:00 AM - 7:00 AM",
  DINNER: "7:00 PM - 8:45 PM",
  LUNCH: "8:45 AM - 12:00 PM",
  SNACKS: "3:00 PM - 5:00 PM",
};

type MealDraft = { items: string; note: string };

type Draft = {
  /** Keyed `DAY:MEAL`. Absent means the hostel publishes nothing then. */
  meals: Record<string, MealDraft>;
  monthEndItems: string;
  monthEndNote: string;
  timings: Record<string, string>;
};

const cellKey = (day: RoutineDay, mealType: MealType) => `${day}:${mealType}`;

/** Items are edited as one comma-separated line — that is how a menu is spoken. */
function splitItems(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function draftFrom(routine: FoodRoutine | null): Draft {
  const meals: Record<string, MealDraft> = {};

  for (const meal of routine?.meals ?? []) {
    meals[`${meal.dayOfWeek}:${meal.mealType}`] = {
      items: meal.items.join(", "),
      note: meal.note ?? "",
    };
  }

  return {
    meals,
    monthEndItems: routine?.monthEndSpecial?.items.join(", ") ?? "",
    monthEndNote: routine?.monthEndSpecial?.note ?? "",
    timings: { ...(routine?.timings ?? {}) } as Record<string, string>,
  };
}

type FoodData = { cook: CookPortalSettings | null; routine: FoodRoutine | null };

async function loadFood(): Promise<FoodData> {
  // Independently, and tolerantly. Both routes want `manageFood`, so in practice
  // they fail together — but a cook-portal outage blanking the menu editor would
  // be a bad trade for one shared `Promise.all`.
  const [routine, cook] = await Promise.all([
    getAdminFoodRoutine().catch(() => null),
    getCookPortal().catch(() => null),
  ]);

  return { cook, routine };
}

export default function ManageFoodScreen() {
  const dates = useDates();
  const food = useResource<FoodData>(useCallback(() => loadFood(), []));

  const [day, setDay] = useState<RoutineDay>(() => todayInNepal());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<MealType | null>(null);
  const [monthEndOpen, setMonthEndOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cookName, setCookName] = useState<string | null>(null);
  const [cookBusy, setCookBusy] = useState(false);

  const loaded = useMemo(() => draftFrom(food.data?.routine ?? null), [food.data]);
  const current = draft ?? loaded;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(loaded);

  const cook = food.data?.cook ?? null;
  const cookNameValue = cookName ?? cook?.cookName ?? "";

  const setCell = useCallback(
    (mealType: MealType, next: MealDraft) => {
      setDraft((prev) => {
        const base = prev ?? loaded;

        return { ...base, meals: { ...base.meals, [cellKey(day, mealType)]: next } };
      });
    },
    [day, loaded],
  );

  const save = useCallback(async () => {
    setSaving(true);

    try {
      /*
       * A cell with no items is *omitted*, not sent empty: the server's schema
       * requires `items` to hold at least one entry, so an emptied meal has to
       * disappear from the payload rather than be sent as `[]`. That is also how
       * a meal is cleared — there is no delete call.
       */
      const meals = ROUTINE_DAYS.flatMap((routineDay) =>
        MEAL_TYPES.flatMap((mealType) => {
          const cell = current.meals[cellKey(routineDay, mealType)];
          const items = splitItems(cell?.items ?? "");

          if (items.length === 0) {
            return [];
          }

          return [
            {
              dayOfWeek: routineDay,
              items,
              mealType,
              note: cell?.note?.trim() || undefined,
            },
          ];
        }),
      );

      const monthEndItems = splitItems(current.monthEndItems);

      await saveFoodRoutine({
        meals,
        monthEndSpecial: {
          items: monthEndItems,
          note: current.monthEndNote.trim() || undefined,
        },
        timings: Object.fromEntries(
          MEAL_TYPES.map((mealType) => [mealType, current.timings[mealType]?.trim() ?? ""]).filter(
            ([, value]) => value,
          ),
        ) as Partial<Record<MealType, string>>,
      });

      toastSuccess("Menu saved", "Residents and the cook see it immediately.");
      setDraft(null);
      await food.reload();
    } catch (error) {
      toastError("Could not save", readApiError(error, "The menu did not save."));
    } finally {
      setSaving(false);
    }
  }, [current, food]);

  const toggleCookPortal = useCallback(
    async (enabled: boolean) => {
      setCookBusy(true);

      try {
        await updateCookPortal({ cookName: cookNameValue.trim() || undefined, enabled });
        toastSuccess(
          enabled ? "Cook portal enabled" : "Cook portal disabled",
          enabled
            ? "A one-time password has been emailed to the cook."
            : "The cook's login is suspended, not deleted.",
        );
        setCookName(null);
        await food.reload();
      } catch (error) {
        toastError("Could not change that", readApiError(error));
      } finally {
        setCookBusy(false);
      }
    },
    [cookNameValue, food],
  );

  if (food.loading) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Food" />}>
        <LoadingState label="Reading this week's menu" />
      </Screen>
    );
  }

  if (food.error) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Food" />}>
        <ErrorState message={food.error} onRetry={food.reload} />
      </Screen>
    );
  }

  const today = todayInNepal();
  const editingCell = editing ? current.meals[cellKey(day, editing)] : undefined;

  return (
    <Screen
      footer={
        dirty ? (
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              label="Discard"
              onPress={() => setDraft(null)}
              variant="outline"
            />
            <Button
              className="flex-[2]"
              label="Save the week"
              loading={saving}
              onPress={() => void save()}
            />
          </View>
        ) : null
      }
      header={<AppBar accent centerTitle showBack subtitle="Menu, times and the kitchen login" title="Food" />}
      onRefresh={food.refresh}
      refreshing={food.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        {food.data?.routine === null ? (
          <PermissionCard capability="food" feature="The weekly menu" />
        ) : (
          <>
            <View>
              <SectionHeader
                subtitle="Tap a meal to change what is served"
                title="The week"
              />
              <View className="gap-3">
                <DayStrip active={day} onChange={setDay} today={today} />

                {MEAL_TYPES.map((mealType) => {
                  const cell = current.meals[cellKey(day, mealType)];
                  const items = splitItems(cell?.items ?? "");

                  return (
                    <MealCard
                      footer={() => (
                        <Button
                          label={items.length > 0 ? "Edit" : "Add a meal"}
                          onPress={() => setEditing(mealType)}
                          size="sm"
                          variant="outline"
                        />
                      )}
                      items={items}
                      key={mealType}
                      mealType={mealType}
                      note={cell?.note ?? ""}
                      timing={current.timings[mealType] ?? ""}
                    />
                  );
                })}
              </View>
            </View>

            <View>
              <SectionHeader
                subtitle="One clock per meal, the same on every day of the week"
                title="Meal times"
              />
              <Card className="gap-3">
                {MEAL_TYPES.map((mealType) => (
                  <Input
                    key={mealType}
                    label={humanizeEnum(mealType)}
                    onChangeText={(value) =>
                      setDraft((prev) => {
                        const base = prev ?? loaded;

                        return {
                          ...base,
                          timings: { ...base.timings, [mealType]: value },
                        };
                      })
                    }
                    placeholder={MEAL_HINTS[mealType]}
                    value={current.timings[mealType] ?? ""}
                  />
                ))}
              </Card>
            </View>

            <View>
              <SectionHeader
                action={
                  <Button
                    label="Edit"
                    onPress={() => setMonthEndOpen(true)}
                    size="sm"
                    variant="outline"
                  />
                }
                subtitle="Served on the last day of the Nepali month"
                title="Month-end special"
              />
              <Card className="gap-2">
                {splitItems(current.monthEndItems).length > 0 ? (
                  <>
                    <View className="flex-row flex-wrap gap-2">
                      {splitItems(current.monthEndItems).map((item) => (
                        <Chip icon="restaurant-outline" key={item} label={item} tone="brand" />
                      ))}
                    </View>
                    {current.monthEndNote ? (
                      <Text variant="caption">{current.monthEndNote}</Text>
                    ) : null}
                  </>
                ) : (
                  <Text variant="muted">
                    Nothing set. Most hostels serve something better on the last day of
                    the month — this is where residents find out what.
                  </Text>
                )}
              </Card>
            </View>
          </>
        )}

        <View>
          <SectionHeader
            subtitle="Lets the kitchen publish photos and say the food is ready"
            title="Cook portal"
          />

          {cook === null ? (
            <PermissionCard capability="food" feature="The cook portal" />
          ) : (
            <Card className="gap-3">
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1">
                  <Text variant="label">
                    {cook.cookPortalEnabled ? "Enabled" : "Not enabled"}
                  </Text>
                  <Text variant="caption">
                    {cook.cookPortalEnabled
                      ? "The cook can sign in on their own phone."
                      : "Turn it on and we email the cook a login."}
                  </Text>
                </View>
                <Toggle
                  accessibilityLabel="Cook portal enabled"
                  disabled={cookBusy}
                  onChange={(enabled) => void toggleCookPortal(enabled)}
                  value={cook.cookPortalEnabled}
                />
              </View>

              {cook.cookPortalEnabled ? (
                <View className="gap-2 border-t border-border pt-3">
                  <FactRow label="Login" value={cook.cookEmail || "—"} />
                  {cook.credentialIssuedAt ? (
                    <FactRow
                      label="Issued"
                      value={dates.date(cook.credentialIssuedAt)}
                    />
                  ) : null}
                  <FactRow
                    label="Password"
                    value={
                      <Badge
                        label={
                          cook.initialPasswordPending
                            ? "First password unused"
                            : "Set by the cook"
                        }
                        tone={cook.initialPasswordPending ? "warning" : "success"}
                      />
                    }
                  />
                  {cook.initialPasswordPending ? null : (
                    <Text variant="caption">
                      Only its hash is stored, so it cannot be looked up — if the cook
                      is locked out, disable and re-enable the portal to issue a new
                      one.
                    </Text>
                  )}
                </View>
              ) : null}

              <Input
                hint={
                  cook.cookPortalEnabled
                    ? "Shown to residents next to food photos and the ready announcement."
                    : "Saved when you enable the portal — the disable path does not write it."
                }
                label="Cook's name"
                onChangeText={setCookName}
                placeholder="Who runs the kitchen"
                value={cookNameValue}
              />

              {/*
                Only offered while the portal is on. `updateCookPortal` branches
                on `enabled` and the **disabled branch never writes `cookName`**
                — so a Save button here would report success and change nothing,
                which is worse than not offering it.
              */}
              {cook.cookPortalEnabled && cookNameValue.trim() !== (cook.cookName ?? "") ? (
                <Button
                  label="Save the name"
                  loading={cookBusy}
                  onPress={() => void toggleCookPortal(true)}
                  size="sm"
                />
              ) : null}
            </Card>
          )}
        </View>
      </View>

      <Sheet
        footer={
          <Button
            label="Done"
            onPress={() => setEditing(null)}
          />
        }
        onClose={() => setEditing(null)}
        open={editing !== null}
        title={editing ? `${humanizeEnum(day)} — ${humanizeEnum(editing)}` : ""}
      >
        <View className="gap-3 pb-2">
          <Input
            hint="Separate them with commas. Clear the field to publish nothing for this meal."
            label="What is served"
            multiline
            onChangeText={(items) =>
              editing ? setCell(editing, { items, note: editingCell?.note ?? "" }) : undefined
            }
            placeholder="Dal, bhat, tarkari, achar"
            style={{ height: 96 }}
            value={editingCell?.items ?? ""}
          />

          <Input
            hint="Anything worth saying about it — “paneer for the veg table”, “festival meal”."
            label="Note"
            multiline
            onChangeText={(note) =>
              editing ? setCell(editing, { items: editingCell?.items ?? "", note }) : undefined
            }
            style={{ height: 80 }}
            value={editingCell?.note ?? ""}
          />

          <Text variant="caption">
            Nothing is sent until you save the week — the button appears at the bottom
            of the screen once something has changed.
          </Text>
        </View>
      </Sheet>

      <Sheet
        footer={<Button label="Done" onPress={() => setMonthEndOpen(false)} />}
        onClose={() => setMonthEndOpen(false)}
        open={monthEndOpen}
        title="Month-end special"
      >
        <View className="gap-3 pb-2">
          <Input
            hint="Separate them with commas."
            label="What is served"
            multiline
            onChangeText={(monthEndItems) =>
              setDraft((prev) => ({ ...(prev ?? loaded), monthEndItems }))
            }
            placeholder="Chicken curry, sel roti, kheer"
            style={{ height: 96 }}
            value={current.monthEndItems}
          />

          <Input
            label="Note"
            multiline
            onChangeText={(monthEndNote) =>
              setDraft((prev) => ({ ...(prev ?? loaded), monthEndNote }))
            }
            style={{ height: 80 }}
            value={current.monthEndNote}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
