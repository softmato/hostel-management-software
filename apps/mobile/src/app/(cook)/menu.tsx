import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useResource } from "@/hooks/use-resource";
import {
  type CookResident,
  type CookToday,
  getCookToday,
  listCookResidents,
} from "@/lib/cook-api";
import { humanizeEnum } from "@/lib/format";
import { MEAL_TYPES, ROUTINE_DAYS, type RoutineDay, todayInNepal } from "@/lib/food-week";

/**
 * The week's routine, and who is eating it. Read-only, both of them.
 *
 * ## Two things on one tab, on purpose
 *
 * They are the kitchen's two reference reads — what to cook, and how many
 * plates — and a cook checks them together at the start of a shift. Splitting
 * them would cost a tab from a four-tab bar whose other two slots (announce,
 * photo) are actions taken several times a day.
 *
 * ## Nothing here is editable, and that is the product
 *
 * `PUT /hostel-admin/food/routine` is behind `manageFood`, a hostel-staff
 * capability a COOK does not hold — and rightly: the menu is what the hostel
 * has promised its residents, and the kitchen changing it silently is how a
 * hostel ends up serving something other than what it advertised. The routine
 * arrives on `GET /cook/today` alongside today's meals, so this screen makes no
 * request of its own.
 *
 * ## The roster is three fields
 *
 * Name and room type. No phone, no email, nothing contactable — the cook login
 * is shared kitchen-wide and effectively static, so this is the list most
 * exposed by a leaked password, and it is deliberately worth no more than a
 * noticeboard.
 */
type MenuData = { residents: CookResident[]; today: CookToday };

async function loadMenu(): Promise<MenuData> {
  const [today, residents] = await Promise.all([getCookToday(), listCookResidents()]);

  return { residents, today };
}

export default function CookMenuScreen() {
  const menu = useResource<MenuData>(useCallback(() => loadMenu(), []), {
    topics: [REALTIME_TOPIC.FOOD, REALTIME_TOPIC.RESIDENTS],
  });

  const [day, setDay] = useState<RoutineDay>(() => todayInNepal());

  const header = <AppBar title="Menu" />;

  if (menu.loading) {
    return (
      <Screen header={header} insideTabs>
        <LoadingState label="Loading the week" />
      </Screen>
    );
  }

  if (menu.error || !menu.data) {
    return (
      <Screen header={header} insideTabs>
        <ErrorState
          message={menu.error ?? "The weekly menu could not be loaded."}
          onRetry={menu.reload}
        />
      </Screen>
    );
  }

  const { residents, today } = menu.data;
  const currentDay = todayInNepal();
  const dayMeals = MEAL_TYPES.map((mealType) =>
    today.routine.meals.find(
      (routineMeal) => routineMeal.dayOfWeek === day && routineMeal.mealType === mealType,
    ),
  );

  return (
    <Screen
      header={header}
      insideTabs
      onRefresh={menu.refresh}
      refreshing={menu.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader
            subtitle={
              today.routine.updatedAt
                ? "Set by the hostel office"
                : "The hostel has not published a routine yet"
            }
            title="This week"
          />

          <ScrollView
            className="-mx-5 mb-3"
            contentContainerClassName="gap-2 px-5"
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {ROUTINE_DAYS.map((routineDay) => {
              const selected = routineDay === day;

              return (
                <Pressable
                  accessibilityRole="button"
                  className={`rounded-full px-4 py-2 ${
                    selected ? "bg-primary" : "border border-border"
                  }`}
                  key={routineDay}
                  onPress={() => setDay(routineDay)}
                >
                  <Text
                    className={`text-sm font-medium ${
                      selected ? "text-primary-foreground" : "text-foreground"
                    }`}
                  >
                    {routineDay.slice(0, 3)}
                    {routineDay === currentDay ? " ·" : ""}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Card>
            {dayMeals.every((meal) => !meal) ? (
              <EmptyState
                description="The hostel office has not filled in this day."
                title="Nothing planned"
              />
            ) : (
              MEAL_TYPES.map((mealType, index) => {
                const meal = dayMeals[index];

                return (
                  <View key={mealType}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      subtitle={meal?.items.join(", ") || "Nothing planned"}
                      title={humanizeEnum(mealType)}
                      value={meal?.timing || today.routine.timings[mealType] || undefined}
                    />
                  </View>
                );
              })
            )}
          </Card>

          {today.routine.monthEndSpecial ? (
            <Card className="mt-3 gap-1">
              <Badge label="Month-end special" tone="success" />
              <Text variant="muted">
                {today.routine.monthEndSpecial.items.join(", ")}
              </Text>
              {today.routine.monthEndSpecial.note ? (
                <Text variant="caption">{today.routine.monthEndSpecial.note}</Text>
              ) : null}
            </Card>
          ) : null}
        </View>

        <View>
          <SectionHeader
            subtitle="Active residents. Names and rooms only."
            title={`Who's eating · ${residents.length}`}
          />
          <Card>
            {residents.length === 0 ? (
              <EmptyState
                description="Nobody is registered as an active resident right now."
                title="No residents"
              />
            ) : (
              residents.map((resident, index) => (
                <View key={resident.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    title={resident.fullName}
                    value={humanizeEnum(resident.roomType)}
                  />
                </View>
              ))
            )}
          </Card>
        </View>
      </View>
    </Screen>
  );
}
