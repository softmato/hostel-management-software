import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { Card } from "@/components/ui/card";
import { FactRow } from "@/components/ui/layout";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import {
  type NightStatusPromptSettings,
  updateAttendanceSettings,
} from "@/lib/admin-manage-api";
import { readApiError } from "@/lib/api-contract";
import { toastError } from "@/lib/toast";
import {
  askingEndsAt,
  REPEAT_EVERY_OPTIONS,
} from "@hostel/night/night-window";

/**
 * The nightly prompt: whether it goes out, at what hour, and how often it asks
 * again. Shown in Settings and, behind "Edit time", on the Night status board —
 * one component so the two can never disagree about what the setting means.
 *
 * ## Why this is a card and not a row in the geofence panel
 *
 * They are two different signals that happen to share a settings document. The
 * geofence records what a **phone was sensed doing**; this records what a
 * **resident said**. A warden turning the prompt on has not turned on location
 * tracking, and burying the switch inside "Change the geofence" would make it
 * look like they had.
 *
 * ## The hour is a picker, not a text field
 *
 * The server refuses anything outside 17:00-23:45 — a prompt before the night
 * starts would file answers under the wrong night, and one after midnight would
 * be sent on the day after the night it asks about. A free text field would let
 * a warden type `08:00`, save it, and get a 422 explaining a rule they had no
 * way to know. Fifteen-minute steps because nobody schedules a roll call at
 * 20:07, and the list stays short enough to scroll.
 *
 * ## It says when the asking stops
 *
 * Whoever has not answered is asked again on the chosen interval until five
 * hours after the hour or 01:00, whichever is first (`promptRound`). The card
 * states the end time as a fact, computed by the same shared function the
 * sender uses, rather than explaining the rule.
 *
 * ## It writes through the attendance settings endpoint
 *
 * The same one the website's editor uses, patching the same field on the same
 * document — so a warden who changes the hour here has changed it on the
 * website by the time they look.
 */
export function NightStatusPromptCard({
  onSaved,
  settings,
}: {
  onSaved: () => void;
  settings: NightStatusPromptSettings;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  /*
    17:00 to 23:45 in quarter hours — the server's own bounds, so the picker
    cannot offer a value the save would reject.
  */
  const times = useMemo(
    () =>
      Array.from({ length: (23 - 17) * 4 + 4 }, (_, index) => {
        const minute = 17 * 60 + index * 15;
        const value = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(
          minute % 60,
        ).padStart(2, "0")}`;

        return { label: value, value };
      }),
    [],
  );

  const repeatOptions = useMemo(
    () =>
      REPEAT_EVERY_OPTIONS.map((minutes) => ({
        label: minutes === 60 ? "Every hour" : `Every ${minutes} minutes`,
        value: String(minutes),
      })),
    [],
  );

  const save = useCallback(
    async (patch: Partial<NightStatusPromptSettings>) => {
      const next = { ...draft, ...patch };

      // Optimistic, then reconciled by `onSaved`. A toggle that waits for a
      // round trip before moving reads as a broken switch.
      setDraft(next);
      setSaving(true);

      try {
        await updateAttendanceSettings({ nightStatus: patch });
        onSaved();
      } catch (error: unknown) {
        setDraft(draft);
        toastError("Could not save that", readApiError(error));
      } finally {
        setSaving(false);
      }
    },
    [draft, onSaved],
  );

  const endsAt = askingEndsAt(draft.promptTime);

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text variant="label">
            {draft.promptEnabled ? "Asking every night" : "Nobody is asked"}
          </Text>
          <Text variant="caption">
            {draft.promptEnabled
              ? `From ${draft.promptTime} until ${endsAt ?? "01:00"}`
              : "Residents tell you from the app themselves."}
          </Text>
        </View>
        <Toggle
          accessibilityLabel="Night status prompt enabled"
          onChange={(promptEnabled) => void save({ promptEnabled })}
          value={draft.promptEnabled}
        />
      </View>

      {draft.promptEnabled ? (
        <View className="gap-3 border-t border-border pt-3">
          <Select
            disabled={saving}
            label="Ask at"
            onChange={(promptTime) => void save({ promptTime })}
            options={times}
            sheetTitle="What time should residents be asked?"
            value={draft.promptTime}
          />

          <Select
            disabled={saving}
            label="Ask again if not answered"
            onChange={(value) => void save({ repeatEveryMinutes: Number(value) })}
            options={repeatOptions}
            sheetTitle="How often should they be asked again?"
            value={String(draft.repeatEveryMinutes)}
          />

          <View className="gap-1">
            <FactRow label="Stops asking" value={endsAt ?? "—"} />
            <FactRow label="Already answered" value="Not asked again" />
          </View>
        </View>
      ) : null}
    </Card>
  );
}
