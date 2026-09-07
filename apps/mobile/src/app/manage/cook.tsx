import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { FloatingButton } from "@/components/ui/floating-button";
import { Input } from "@/components/ui/input";
import { Chip, FactRow } from "@/components/ui/layout";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { SkeletonCard } from "@/components/ui/skeleton";
import { EmptyCard, ErrorState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useDates } from "@/hooks/use-dates";
import { useResource } from "@/hooks/use-resource";
import {
  addCook,
  type CookAccount,
  type CookCredentials,
  removeCook,
  updateCook,
} from "@/lib/admin-manage-api";
import { adminQuery, type CookRoster } from "@/lib/admin-queries";
import { readApiError } from "@/lib/api-contract";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Cooks — who is allowed to tell the hostel that food is ready.
 *
 * ## Why this is a screen and not a card at the bottom of Food
 *
 * It was that card. It fitted while a hostel had exactly one cook and the only
 * decisions were a name and a switch. It stopped fitting the moment there were
 * two kinds of cook, a list of them, a rotate, a remove and a history of people
 * who used to be here — that is a screen's worth of decisions, and burying it
 * under the week's menu meant scrolling past twenty-eight meal cells to reach
 * the thing you opened Food for. `manage/food.tsx` now carries a single row
 * pointing here, and this screen owns the job.
 *
 * ## Two ways to give somebody the kitchen
 *
 * - **Create a sign-in.** We mint a short address and a password and show them
 *   once. Nothing is emailed to the cook because there is no mailbox — the
 *   admin reads the two lines out. This is the kitchen-shares-one-phone case.
 * - **Invite by email.** The cook's own address gets a link; opening it turns
 *   their account into the cook account. Exactly what a resident does for a
 *   guardian.
 *
 * The picker defaults to *Create a sign-in*, because most cooks do not have an
 * email they check, and the invite path is one tap away for the ones who do.
 *
 * ## The password is shown once and then it is gone
 *
 * Not a UI choice — only a bcrypt hash is stored, so there is no second read
 * for any screen to make. That is why the credentials sheet has a copy button
 * and stays up until it is dismissed deliberately, and why the answer to "we
 * lost it" is Rotate rather than a reveal.
 *
 * ## Removed cooks stay on the screen
 *
 * Below a divider, greyed, showing the name their past announcements and photos
 * are now filed under. They are not clutter: they are the reason a meal logged
 * two months ago still has somebody's name against it, and the only place an
 * admin can see that the label reads "Previous Sunrise cook".
 */

type Mode = "CREDENTIAL" | "INVITE";

const MODES: { label: string; value: Mode }[] = [
  { label: "Create a sign-in", value: "CREDENTIAL" },
  { label: "Invite by email", value: "INVITE" },
];

/** What the credentials sheet is showing, and which cook it belongs to. */
type Issued = { cookName: string; credentials: CookCredentials; rotated: boolean };

export default function ManageCookScreen() {
  const dates = useDates();
  const { colors } = useAppTheme();
  const query = adminQuery.cooks();
  const roster = useResource<CookRoster>(query.load, {
    cacheKey: query.key,
    topics: query.topics,
  });

  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<Mode>("CREDENTIAL");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [editing, setEditing] = useState<CookAccount | null>(null);
  const [editedName, setEditedName] = useState("");

  const cooks = useMemo(() => roster.data?.cooks ?? [], [roster.data]);
  const live = cooks.filter((cook) => cook.status !== "REMOVED");
  const past = cooks.filter((cook) => cook.status === "REMOVED");
  const { reload } = roster;

  const openAdd = useCallback(() => {
    setMode("CREDENTIAL");
    setName("");
    setEmail("");
    setAdding(true);
  }, []);

  const submit = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (trimmedName.length < 2) {
      toastError("Name them", "What residents will see beside the food.");
      return;
    }

    if (mode === "INVITE" && !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      toastError("Check the email", "The invitation goes to this address.");
      return;
    }

    setBusy(true);

    try {
      const result = await addCook(
        mode === "CREDENTIAL"
          ? { kind: "CREDENTIAL", name: trimmedName }
          : { email: trimmedEmail, kind: "INVITE", name: trimmedName },
      );

      setAdding(false);

      if (result.credentials) {
        // Straight into the sheet. This response is the only place the password
        // will ever exist — a toast that disappears in four seconds is not
        // where you put something that cannot be fetched again.
        setIssued({
          cookName: trimmedName,
          credentials: result.credentials,
          rotated: false,
        });
      } else {
        toastSuccess("Invitation sent", `${trimmedEmail} has seven days to accept.`);
      }

      await reload();
    } catch (error) {
      toastError("Could not add that cook", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [email, mode, name, reload]);

  const rotate = useCallback(
    (cook: CookAccount) => {
      Alert.alert(
        `New password for ${cook.name}?`,
        "The current one stops working immediately and they are signed out of every device.",
        [
          { style: "cancel", text: "Cancel" },
          {
            onPress: () => {
              void (async () => {
                try {
                  const result = await updateCook(cook.id, { rotate: true });

                  if (result.credentials) {
                    setIssued({
                      cookName: cook.name,
                      credentials: result.credentials,
                      rotated: true,
                    });
                  }

                  await reload();
                } catch (error) {
                  toastError("Could not rotate", readApiError(error));
                }
              })();
            },
            text: "Issue a new one",
          },
        ],
      );
    },
    [reload],
  );

  const rename = useCallback(async () => {
    if (!editing) {
      return;
    }

    setBusy(true);

    try {
      await updateCook(editing.id, { name: editedName.trim() });
      toastSuccess("Name saved");
      setEditing(null);
      await reload();
    } catch (error) {
      toastError("Could not save", readApiError(error));
    } finally {
      setBusy(false);
    }
  }, [editedName, editing, reload]);

  const remove = useCallback(
    (cook: CookAccount) => {
      Alert.alert(
        `Remove ${cook.name}?`,
        cook.kind === "CREDENTIAL"
          ? "This sign-in is deleted and cannot be used again. Everything they already announced stays, under “previous cook”."
          : "They stop being a cook here. Their own account is untouched. Everything they already announced stays, under “previous cook”.",
        [
          { style: "cancel", text: "Keep them" },
          {
            onPress: () => {
              void (async () => {
                try {
                  const removed = await removeCook(cook.id);

                  toastSuccess(
                    "Removed",
                    removed.historicalName
                      ? `Their past work now reads “${removed.historicalName}”.`
                      : undefined,
                  );
                  await reload();
                } catch (error) {
                  toastError("Could not remove", readApiError(error));
                }
              })();
            },
            style: "destructive",
            text: "Remove",
          },
        ],
      );
    },
    [reload],
  );

  const copy = useCallback(async (value: string, what: string) => {
    await Clipboard.setStringAsync(value);
    toastSuccess(`${what} copied`);
  }, []);

  if (roster.loading) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Cooks" />} scroll>
        <View className="gap-4 pt-1">
          <SkeletonCard rows={3} />
          <SkeletonCard rows={3} />
        </View>
      </Screen>
    );
  }

  if (roster.error) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="Cooks" />}>
        <ErrorState message={roster.error} onRetry={roster.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      floating={
        <FloatingButton icon="person-add-outline" label="Add a cook" onPress={openAdd} />
      }
      header={<AppBar accent centerTitle showBack title="Cooks" />}
      onRefresh={roster.refresh}
      refreshing={roster.refreshing}
      scroll
    >
      <View className="gap-6 pt-1">
        <View>
          {/* Heading outside the card, the way every list in this app groups. */}
          <SectionHeader
            subtitle="They can announce a meal and post photos of it. Nothing else."
            title="In the kitchen"
          />

          {live.length === 0 ? (
            <EmptyCard
              description="Add one and they get a sign-in of their own — either a short login you hand over, or an invitation to their own email."
              title="Nobody has the kitchen"
            />
          ) : (
            <View className="gap-3">
              {live.map((cook) => (
                <Card className="gap-3" key={cook.id}>
                  <View className="flex-row items-center gap-3">
                    <Avatar name={cook.name} size="md" />

                    <View className="flex-1">
                      <Text numberOfLines={1} variant="subtitle">
                        {cook.name}
                      </Text>
                      <Text numberOfLines={1} variant="caption">
                        {cook.loginEmail}
                      </Text>
                    </View>

                    <Pressable
                      accessibilityLabel={`Copy ${cook.name}'s sign-in`}
                      hitSlop={10}
                      onPress={() => void copy(cook.loginEmail, "Sign-in")}
                    >
                      <Ionicons color={colors.mutedForeground} name="copy-outline" size={18} />
                    </Pressable>
                  </View>

                  <View className="flex-row flex-wrap gap-2">
                    <Chip
                      icon={cook.kind === "CREDENTIAL" ? "key-outline" : "mail-outline"}
                      label={cook.kind === "CREDENTIAL" ? "Sign-in issued" : "Own email"}
                      tone="brand"
                    />
                    {cook.invitationPending ? (
                      <Badge label="Invitation not accepted" tone="warning" />
                    ) : null}
                    {cook.initialPasswordPending ? (
                      <Badge label="First password unused" tone="warning" />
                    ) : null}
                  </View>

                  <View className="gap-2 border-t border-border pt-3">
                    {cook.addedAt ? (
                      <FactRow label="Added" value={dates.date(cook.addedAt)} />
                    ) : null}
                    {cook.kind === "CREDENTIAL" && cook.credentialIssuedAt ? (
                      <FactRow
                        label="Password issued"
                        value={dates.date(cook.credentialIssuedAt)}
                      />
                    ) : null}
                    {cook.invitationPending && cook.invitationExpiresAt ? (
                      <FactRow
                        label="Link expires"
                        value={dates.date(cook.invitationExpiresAt)}
                      />
                    ) : null}
                  </View>

                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      label="Rename"
                      onPress={() => {
                        setEditing(cook);
                        setEditedName(cook.name);
                      }}
                      size="sm"
                      variant="outline"
                    />
                    {/*
                      Only for a generated sign-in. An invited cook signs in with
                      their own password on their own account — there is nothing
                      of ours to rotate, and offering the button would promise a
                      reset we are not allowed to perform.
                    */}
                    {cook.kind === "CREDENTIAL" ? (
                      <Button
                        label="New password"
                        onPress={() => rotate(cook)}
                        size="sm"
                        variant="outline"
                      />
                    ) : null}
                    <Button
                      label="Remove"
                      onPress={() => remove(cook)}
                      size="sm"
                      variant="danger"
                    />
                  </View>
                </Card>
              ))}
            </View>
          )}
        </View>

        {past.length > 0 ? (
          <View>
            <SectionHeader
              subtitle="No access. Their announcements and photos are kept under these names."
              title="No longer here"
            />

            <Card className="gap-3">
              {past.map((cook) => (
                <View
                  className="flex-row items-center gap-3"
                  key={cook.id}
                >
                  <Ionicons
                    color={colors.mutedForeground}
                    name="time-outline"
                    size={18}
                  />
                  <View className="flex-1">
                    <Text numberOfLines={1} variant="label">
                      {cook.historicalName || cook.name}
                    </Text>
                    <Text numberOfLines={1} variant="caption">
                      {cook.removedAt
                        ? `Was ${cook.name} · removed ${dates.date(cook.removedAt)}`
                        : `Was ${cook.name}`}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}
      </View>

      <Sheet
        footer={
          <Button
            label={mode === "CREDENTIAL" ? "Create the sign-in" : "Send the invitation"}
            loading={busy}
            onPress={() => void submit()}
          />
        }
        onClose={() => setAdding(false)}
        open={adding}
        title="Add a cook"
      >
        <View className="gap-3 pb-2">
          <Segmented
            onChange={(value) => setMode(value as Mode)}
            options={MODES}
            value={mode}
          />

          <Input
            hint="Shown to residents beside food photos and the ready announcement."
            label="Cook's name"
            onChangeText={setName}
            placeholder="Who runs the kitchen"
            value={name}
          />

          {mode === "INVITE" ? (
            <Input
              autoCapitalize="none"
              hint="They open the link and their own account becomes the cook account. The link lasts seven days."
              keyboardType="email-address"
              label="Their email"
              onChangeText={setEmail}
              placeholder="cook@gmail.com"
              value={email}
            />
          ) : (
            <Text variant="caption">
              We make a short sign-in and a password and show them to you once — the
              cook needs no email at all. Write them down before closing the next
              screen; they cannot be looked up afterwards.
            </Text>
          )}
        </View>
      </Sheet>

      <Sheet
        footer={<Button label="I have written it down" onPress={() => setIssued(null)} />}
        onClose={() => setIssued(null)}
        open={issued !== null}
        title={issued?.rotated ? "New password" : "Their sign-in"}
      >
        <View className="gap-3 pb-2">
          <Text variant="muted">
            {issued?.rotated
              ? `${issued.cookName}'s old password no longer works. Give them these.`
              : `Give these to ${issued?.cookName}. They will be asked to choose their own password the first time they sign in.`}
          </Text>

          <Card className="gap-3">
            <Pressable
              accessibilityLabel="Copy the sign-in address"
              onPress={() =>
                issued ? void copy(issued.credentials.email, "Sign-in") : undefined
              }
            >
              <FactRow
                label="Sign-in"
                value={
                  <Text className="font-mono" variant="label">
                    {issued?.credentials.email}
                  </Text>
                }
              />
            </Pressable>

            <Pressable
              accessibilityLabel="Copy the password"
              onPress={() =>
                issued
                  ? void copy(issued.credentials.temporaryPassword, "Password")
                  : undefined
              }
            >
              <FactRow
                label="Password"
                value={
                  <Text className="font-mono" variant="label">
                    {issued?.credentials.temporaryPassword}
                  </Text>
                }
              />
            </Pressable>

            <Text variant="caption">Tap either line to copy it.</Text>
          </Card>

          <Text variant="caption">
            A copy has been emailed to you as well. Once this sheet closes the password
            is gone for good — if it is lost, issue a new one from this screen.
          </Text>
        </View>
      </Sheet>

      <Sheet
        footer={
          <Button label="Save" loading={busy} onPress={() => void rename()} />
        }
        onClose={() => setEditing(null)}
        open={editing !== null}
        title="Rename"
      >
        <View className="gap-3 pb-2">
          <Input
            hint="Only the display name. Their sign-in does not change."
            label="Cook's name"
            onChangeText={setEditedName}
            value={editedName}
          />
        </View>
      </Sheet>
    </Screen>
  );
}
