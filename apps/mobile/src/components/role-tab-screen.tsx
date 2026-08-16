import { router } from "expo-router";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { readableRole } from "@/constants/roles";
import { useAppSelector } from "@/hooks/redux";
import { endSession } from "@/lib/auth-session";

/**
 * Stands in for a signed-in tab that is scaffolded but not built yet.
 *
 * It states which phase fills it in rather than showing invented data — a
 * placeholder that looks like a working screen is worse than an obvious empty
 * one, because nobody remembers to come back to it.
 *
 * Delete each usage as its phase lands; when nothing imports this, delete it.
 */
export function RoleTabScreen({
  summary,
  title,
}: {
  summary: string;
  title: string;
}) {
  const account = useAppSelector((state) => state.auth.account);

  return (
    <Screen header={<AppBar title={title} />} insideTabs scroll>
      <View className="gap-4 pt-2">
        <Card className="gap-2">
          <Text variant="subtitle">{title}</Text>
          <Text variant="muted">{summary}</Text>
        </Card>

        {account ? (
          <Card className="gap-1">
            <Text variant="label">Signed in</Text>
            <Text variant="muted">{account.name}</Text>
            <Text variant="caption">
              {readableRole(account.role)}
              {account.email ? ` · ${account.email}` : ""}
            </Text>
          </Card>
        ) : null}

        <Button
          label="Sign out"
          onPress={async () => {
            await endSession();
            router.replace("/(public)");
          }}
          variant="outline"
        />
      </View>
    </Screen>
  );
}
