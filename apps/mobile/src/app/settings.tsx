import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Alert, Linking, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ListRow, RowDivider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import {
  type DeletionStatus,
  getDeletionStatus,
  requestAccountDeletion,
} from "@/lib/account-api";
import {
  canRequestDeletion,
  deletionReasonError,
  MAX_DELETION_REASON,
  PATHWAY_COPY,
} from "@/lib/account-pathways";
import { API_BASE_URL } from "@/lib/api";
import { readApiError } from "@/lib/api-contract";
import { endSession } from "@/lib/auth-session";
import { formatDate } from "@/lib/format";
import {
  describePreference,
  formatMinutes,
  MUTABLE_CATEGORIES,
  type NotificationPreference,
  parseMinutes,
} from "@/lib/notification-preferences";
import {
  getNotificationPreference,
  updateNotificationPreference,
} from "@/lib/notification-preferences-api";
import {
  type PushPermission,
  registerPushToken,
  requestPushPermission,
} from "@/lib/push-notifications";
import { toastError, toastSuccess } from "@/lib/toast";
import { setThemePreference, type ThemePreference } from "@/store/slices/uiSlice";

/**
 * Settings — theme, notifications, privacy, and closing the account.
 *
 * The privacy half is a port of `apps/web/src/app/(auth)/account/privacy/page.tsx`
 * ("Privacy & your data" / "Control what … keeps about you") and the
 * `AccountDeletionPanel` inside it, including its four pathways and their copy
 * verbatim — see `lib/account-pathways.ts` for why that copy is not paraphrased.
 *
 * ## Theme is local; notifications are not
 *
 * **Theme** is local by design: it lives in `uiSlice` and nothing is sent
 * anywhere, because it describes this phone rather than this person.
 * **Notification preferences** are the opposite — they decide what the *server*
 * sends, so they live on the server (`NotificationPreference`, read by
 * `push.service.ts` before every send). This section was a paragraph explaining
 * that no such model existed until 2026-08-18; every switch in it is now real.
 */

const THEME_OPTIONS: { hint: string; label: string; value: ThemePreference }[] = [
  { hint: "The product's own look", label: "Light", value: "light" },
  { hint: "Easier at night", label: "Dark", value: "dark" },
  { hint: "Follow your phone", label: "System", value: "system" },
];

export default function SettingsScreen() {
  const dispatch = useAppDispatch();
  const preference = useAppSelector((state) => state.ui.themePreference);
  const { colors } = useAppTheme();

  const deletion = useResource<DeletionStatus>(
    useCallback(() => getDeletionStatus(), []),
  );

  const openPrivacyPolicy = useCallback(async () => {
    /*
     * The public policy page, opened in the OS browser rather than a WebView: it is
     * a legal document people should be able to see the address of, and
     * `openBrowserAsync` gives them the URL bar and their own reader mode.
     */
    await WebBrowser.openBrowserAsync(`${API_BASE_URL}/privacy`);
  }, []);

  return (
    <Screen
      header={<AppBar showBack title="Settings" />}
      onRefresh={deletion.refresh}
      refreshing={deletion.refreshing}
      scroll
    >
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader subtitle="Stored on this phone only" title="Appearance" />
          <Card>
            {THEME_OPTIONS.map((option, index) => {
              const active = option.value === preference;

              return (
                <View key={option.value}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    onPress={() => dispatch(setThemePreference(option.value))}
                    right={
                      <Ionicons
                        color={active ? colors.primary : colors.border}
                        name={active ? "radio-button-on" : "radio-button-off"}
                        size={20}
                      />
                    }
                    subtitle={option.hint}
                    title={option.label}
                  />
                </View>
              );
            })}
          </Card>
        </View>

        <NotificationSettings />

        <View>
          <SectionHeader
            subtitle="Control what we keep about you"
            title="Privacy & your data"
          />
          <Card>
            <ListRow
              icon="document-text-outline"
              onPress={() => void openPrivacyPolicy()}
              subtitle="What we collect, why, and for how long"
              title="Privacy policy"
            />
          </Card>
        </View>

        {deletion.loading ? (
          <LoadingState />
        ) : deletion.error || !deletion.data ? (
          <ErrorState
            message={deletion.error ?? "Your account settings could not be loaded."}
            onRetry={deletion.reload}
          />
        ) : (
          <DeletionPanel onChanged={deletion.refresh} status={deletion.data} />
        )}
      </View>
    </Screen>
  );
}

/**
 * Notifications — what may interrupt, and when.
 *
 * ## Every switch here is real
 *
 * This section used to be a paragraph explaining that no preference existed on
 * the server, because a toggle that reverted on the next fetch while the server
 * kept sending would have been worse than no toggle. `NotificationPreference`
 * and the check inside `push.service.ts` now exist, so these are controls.
 *
 * ## Saved on change, not behind a Save button
 *
 * A settings screen with a Save button loses the change of anyone who backs out,
 * and on a phone backing out is a gesture people make without deciding to. So
 * each switch PATCHes its own field, the UI moves first, and a failure puts the
 * old value back and says so. `updateNotificationPreference` takes a partial for
 * exactly this reason.
 *
 * ## Urgent is stated, not offered
 *
 * SOS overrides the master switch, quiet hours and any mute — server-side, in
 * `shouldPush`. So the screen says so plainly and `MUTABLE_CATEGORIES` has no SOS
 * row: a switch the server ignores is a lie, and this is the one place where
 * believing it could matter.
 *
 * ## Times are typed, not picked
 *
 * A wheel picker means a native module and a modal for a value people set once.
 * A 5-character field with `parseMinutes` guarding it is the smaller thing that
 * does the same job — and it is checked before the PATCH, so a typo is an inline
 * message rather than a 400.
 */
function NotificationSettings() {
  const resource = useResource<NotificationPreference>(
    useCallback(() => getNotificationPreference(), []),
  );

  const [saving, setSaving] = useState(false);
  /*
   * The OS-level permission, which is a separate thing from the server-side
   * preference below. Someone can have `pushEnabled: true` saved and still
   * receive nothing because the phone is blocking it — so both are shown, and
   * the one that is actually in the way is the one offered a button.
   *
   * Read without asking (`ask` defaults to false), so opening Settings never
   * fires the system dialogue on its own.
   */
  const [permission, setPermission] = useState<PushPermission | null>(null);

  useFocusEffect(
    useCallback(() => {
      // On focus rather than on mount: the blocked case sends people to system
      // settings, and they come back to this screen expecting it to have noticed.
      let cancelled = false;

      void requestPushPermission().then((next) => {
        if (!cancelled) {
          setPermission(next);
        }
      });

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const enablePush = useCallback(async () => {
    if (permission === "blocked") {
      // The dialogue will never appear again, so the only route left is the
      // phone's own settings page for this app.
      await Linking.openSettings();
      return;
    }

    const result = await registerPushToken({ ask: true, force: true });

    setPermission(result.permission);

    if (result.permission === "granted") {
      toastSuccess("Notifications on", "This phone will get alerts from now on.");
    }
  }, [permission]);

  const preference = resource.data;

  const patch = useCallback(
    (next: Partial<NotificationPreference>) => {
      const previous = preference;

      if (!previous) {
        return;
      }

      // Optimistic: the switch moves under the thumb that pressed it. Anything
      // slower reads as the control being broken.
      resource.setData((current) => (current ? { ...current, ...next } : current));
      setSaving(true);

      void updateNotificationPreference(next)
        .then((saved) => resource.setData(() => saved))
        .catch((caught: unknown) => {
          resource.setData(() => previous);
          toastError("Couldn't save that", readApiError(caught));
        })
        .finally(() => setSaving(false));
    },
    [preference, resource],
  );

  if (resource.loading) {
    return (
      <View>
        <SectionHeader title="Notifications" />
        <LoadingState />
      </View>
    );
  }

  if (resource.error || !preference) {
    return (
      <View>
        <SectionHeader title="Notifications" />
        <ErrorState
          message={resource.error ?? "Your notification settings could not be loaded."}
          onRetry={resource.reload}
        />
      </View>
    );
  }

  return (
    <View>
      <SectionHeader subtitle={describePreference(preference)} title="Notifications" />

      {/*
        The permission prompt lives here, and nowhere else.

        Nothing asks at boot: on Android 13+ a second refusal sets
        `canAskAgain: false` permanently, so the dialogue over a dashboard
        somebody has not read yet spends the app's one chance at the worst
        possible moment. Here it follows a sentence explaining what it is for.

        `blocked` gets different copy because it needs a different action — the
        dialogue will never appear again, and a button offering it would do
        nothing.
      */}
      {permission === "granted" || permission === "unsupported" ? null : (
        <View className="pb-3">
          <Card className="gap-2">
            <Text variant="label">
              {permission === "blocked"
                ? "Notifications are switched off for this app"
                : "Let us notify this phone"}
            </Text>
            <Text variant="muted">
              {permission === "blocked"
                ? "Your phone is blocking them, so we cannot ask again from here. Turn them back on in your phone's settings for HostelHub."
                : "Rent reminders, meal announcements and safety alerts arrive as they happen. Everything below still applies once it is on."}
            </Text>
            <Button
              label={permission === "blocked" ? "Open phone settings" : "Turn on notifications"}
              onPress={() => void enablePush()}
              variant="outline"
            />
          </Card>
        </View>
      )}

      <Card>
        <ListRow
          right={
            <Toggle
              accessibilityLabel="Push notifications"
              disabled={saving}
              onChange={(next) => patch({ pushEnabled: next })}
              value={preference.pushEnabled}
            />
          }
          subtitle="Alerts on your phone. The bell in the app is unaffected."
          title="Push notifications"
        />

        <RowDivider />

        <ListRow
          right={
            <Toggle
              accessibilityLabel="Quiet hours"
              disabled={saving || !preference.pushEnabled}
              onChange={(next) => patch({ quietHoursEnabled: next })}
              value={preference.quietHoursEnabled}
            />
          }
          subtitle="Hold everything except urgent alerts overnight"
          title="Quiet hours"
        />

        {preference.quietHoursEnabled && preference.pushEnabled ? (
          <View className="flex-row gap-3 pb-3 pt-1">
            <View className="flex-1">
              <TimeField
                label="From"
                onCommit={(minutes) => patch({ quietHoursStart: minutes })}
                value={preference.quietHoursStart}
              />
            </View>
            <View className="flex-1">
              <TimeField
                label="Until"
                onCommit={(minutes) => patch({ quietHoursEnd: minutes })}
                value={preference.quietHoursEnd}
              />
            </View>
          </View>
        ) : null}
      </Card>

      <View className="pt-3">
        <Card>
          <Text className="pb-1" variant="label">
            Mute a type
          </Text>
          <Text className="pb-2" variant="muted">
            You will still see these in the app — this only stops the buzz.
          </Text>

          {MUTABLE_CATEGORIES.map((category, index) => {
            const muted = preference.mutedCategories.includes(category.value);

            return (
              <View key={category.value}>
                {index > 0 ? <RowDivider /> : null}
                <ListRow
                  right={
                    <Toggle
                      accessibilityLabel={`Mute ${category.label}`}
                      disabled={saving || !preference.pushEnabled}
                      onChange={(next) =>
                        patch({
                          mutedCategories: next
                            ? [...preference.mutedCategories, category.value]
                            : preference.mutedCategories.filter(
                                (value) => value !== category.value,
                              ),
                        })
                      }
                      value={muted}
                    />
                  }
                  subtitle={category.description}
                  title={category.label}
                />
              </View>
            );
          })}
        </Card>
      </View>

      <View className="pt-3">
        <Card className="gap-1">
          <Text variant="label">Urgent alerts always come through</Text>
          <Text variant="muted">
            An SOS reaches your phone whatever is set here — through quiet hours, a
            muted type, and with push switched off. Nothing on this screen can
            silence one, on purpose.
          </Text>
        </Card>
      </View>
    </View>
  );
}

/**
 * One end of the quiet-hours window.
 *
 * Held as text while it is being typed and only committed on blur: parsing every
 * keystroke means "0" is a valid partial that would PATCH `00:00` before the
 * hour is finished. An unparseable value snaps back to what was saved, so the
 * field can never be left showing something the server does not hold.
 */
function TimeField({
  label,
  onCommit,
  value,
}: {
  label: string;
  onCommit: (minutes: number) => void;
  value: number;
}) {
  const [draft, setDraft] = useState(() => formatMinutes(value));
  const [error, setError] = useState<string | null>(null);

  const commit = useCallback(() => {
    const minutes = parseMinutes(draft);

    if (minutes === null) {
      setDraft(formatMinutes(value));
      setError(null);
      return;
    }

    setError(null);

    if (minutes !== value) {
      onCommit(minutes);
    }
  }, [draft, onCommit, value]);

  return (
    <Input
      error={error ?? undefined}
      keyboardType="numbers-and-punctuation"
      label={label}
      maxLength={5}
      onBlur={commit}
      onChangeText={setDraft}
      placeholder="22:00"
      value={draft}
    />
  );
}

/**
 * Closing the account.
 *
 * The server decides what the button does (`resolvePathway`) and the client renders
 * that pathway's copy. **A resident with an `ACTIVE` or `PENDING` residency is
 * `BLOCKED`**, which makes it the likeliest state on this app — so that branch is
 * a real explanation rather than a disabled button.
 */
function DeletionPanel({
  onChanged,
  status,
}: {
  onChanged: () => void;
  status: DeletionStatus;
}) {
  const { colors } = useAppTheme();
  const copy = PATHWAY_COPY[status.pathway];

  const [composing, setComposing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(() => {
    const problem = deletionReasonError(reason, status.pathway);

    if (problem) {
      setError(problem);
      return;
    }

    setError(null);

    /*
     * The last gate before something that closes an account, revokes guardian
     * access, or goes to the platform owner — and the copy is pathway-specific
     * because the consequence is. Same double confirmation the web has.
     */
    Alert.alert(copy.confirmTitle, copy.confirmDescription, [
      { style: "cancel", text: "Keep my account" },
      {
        onPress: () => {
          setBusy(true);

          void requestAccountDeletion(reason.trim())
            .then(async (result) => {
              // The server's own message, which differs by pathway.
              toastSuccess("Request sent", result.message);
              setComposing(false);
              setReason("");

              /*
               * `SELF_SERVICE` closes the account on the spot, so the session in
               * memory is already dead — staying on a signed-in screen would show
               * a shell that 401s on every request. The other pathways change
               * nothing about signing in, so they simply refresh.
               */
              if (result.data.pathway === "SELF_SERVICE") {
                await endSession();
                router.replace("/(public)");
                return;
              }

              onChanged();
            })
            .catch((caught: unknown) => setError(readApiError(caught)))
            .finally(() => setBusy(false));
        },
        style: "destructive",
        text: copy.action,
      },
    ]);
  }, [copy, onChanged, reason, status.pathway]);

  const open = status.request;

  return (
    <View>
      <SectionHeader title="Your account" />

      <Card className="gap-3">
        <View className="flex-row items-start gap-3">
          <View
            className="h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: `${colors.destructive}1A` }}
          >
            <Ionicons color={colors.destructive} name="shield-outline" size={19} />
          </View>

          <View className="flex-1 gap-2">
            <Text variant="subtitle">{copy.heading}</Text>

            <Text variant="muted">
              {status.pathway === "BLOCKED" ? status.blockedReason : copy.body}
            </Text>

            {status.pathway === "PLATFORM_REVIEW" && status.hostelNames.length > 0 ? (
              <Text variant="caption">
                Attached to this account: {status.hostelNames.join(", ")}.
              </Text>
            ) : null}
          </View>
        </View>

        {open ? (
          // An open request replaces the action entirely — there is nothing left
          // to ask for, and a second button would file a duplicate.
          <View className="gap-1 rounded-xl border border-border bg-muted/40 p-3">
            {open.kind === "PLATFORM_REVIEW" ? (
              <Text variant="muted">
                Your request is with the platform owner
                {open.reviewStatus ? ` (${open.reviewStatus.toLowerCase()})` : ""}. Your
                account is unaffected in the meantime.
              </Text>
            ) : (
              <Text variant="muted">
                Your account is closed and will be erased on{" "}
                {open.scheduledDeletionAt
                  ? formatDate(open.scheduledDeletionAt)
                  : "the scheduled date"}
                . Use the link in your email to undo it.
              </Text>
            )}
          </View>
        ) : !canRequestDeletion(status.pathway) ? null : composing ? (
          <View className="gap-3 border-t border-border pt-3">
            <Input
              error={error}
              hint={`At least 10 characters. ${
                status.pathway === "PLATFORM_REVIEW"
                  ? "The platform owner reads this."
                  : "It helps us fix what drove you away."
              }`}
              label="Why are you leaving?"
              maxLength={MAX_DELETION_REASON}
              multiline
              onChangeText={setReason}
              placeholder="A sentence or two."
              style={{ height: 88, paddingTop: 12, textAlignVertical: "top" }}
              value={reason}
            />

            {/*
              Filled red only once the action is armed. A solid destructive button
              at rest would be the loudest thing on a screen that is otherwise three
              sections of ordinary rows; outlined asks, filled confirms.
            */}
            <Button
              haptic={false}
              label={copy.action}
              loading={busy}
              onPress={submit}
              variant="danger"
            />
            <Button
              label="Keep my account"
              onPress={() => {
                setComposing(false);
                setReason("");
                setError(null);
              }}
              variant="ghost"
            />
          </View>
        ) : (
          <View className="border-t border-border pt-3">
            <Button
              label={copy.action}
              onPress={() => setComposing(true)}
              variant="outline"
            />
          </View>
        )}
      </Card>
    </View>
  );
}
