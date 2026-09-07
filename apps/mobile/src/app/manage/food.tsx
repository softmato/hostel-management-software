import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { DayStrip, MealCard } from "@/components/food-routine";
import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/layout";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Sheet } from "@/components/ui/sheet";
import { ErrorState, LoadingState, PermissionCard } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useResource } from "@/hooks/use-resource";
import { saveFoodRoutine } from "@/lib/admin-manage-api";
import {
  type AdminFoodData,
  adminQuery,
  prefetchAdminRoute,
} from "@/lib/admin-queries";
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
 * ## The kitchen is one row, not a section
 *
 * Deciding what is served and deciding who may say it is ready are the same
 * person's decisions, so a door to the cooks belongs here. It used to be the
 * whole control panel — a switch, a name field, a login, a password status —
 * and that stopped fitting when a hostel could have several cooks, invited as
 * well as issued, each removable. `manage/cook.tsx` owns that now; this screen
 * points at it.
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

/* `FoodData` and its loader are `adminQuery.food()` — see `lib/admin-queries.ts`. */

export default function ManageFoodScreen() {
  const query = adminQuery.food();
  const food = useResource<AdminFoodData>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const [day, setDay] = useState<RoutineDay>(() => todayInNepal());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<MealType | null>(null);
  const [monthEndOpen, setMonthEndOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const loaded = useMemo(() => draftFrom(food.data?.routine ?? null), [food.data]);
  const current = draft ?? loaded;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(loaded);

  const cook = food.data?.cook ?? null;

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
            subtitle="Who is allowed to say the food is ready"
            title="The kitchen"
          />

          {/*
            A door, not a card.

            This section used to be the cook portal itself — a switch, a name
            field, a login and a password status. That fitted while a hostel had
            one cook. It now has a roster, two ways of granting access, a
            password rotation and a removal that renames a departed cook's
            history, and none of that belongs underneath twenty-eight meal cells
            on the screen somebody opened to fix Thursday's lunch.

            `PermissionCard` still guards it, because `manageFood` is what the
            roster routes are gated on and a warden without it should be told so
            here rather than after the tap.
          */}
          {cook === null ? (
            <PermissionCard capability="food" feature="Cooks" />
          ) : (
            <Card className="p-0">
              <ListRow
                icon="flame-outline"
                onPress={() => router.push("/manage/cook")}
                onPressIn={() => prefetchAdminRoute("/manage/cook")}
                subtitle={
                  cook.cookPortalEnabled
                    ? cook.cookName
                      ? `${cook.cookName} can announce meals and post photos`
                      : "Somebody can announce meals and post photos"
                    : "Nobody has the kitchen yet"
                }
                title="Cooks"
                value={cook.cookPortalEnabled ? "Open" : "Set up"}
              />
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
