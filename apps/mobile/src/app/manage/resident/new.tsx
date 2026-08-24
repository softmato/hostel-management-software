import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/layout";
import { Screen } from "@/components/ui/screen";
import { Select } from "@/components/ui/select";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import { useResource } from "@/hooks/use-resource";
import {
  createResident,
  getManagedHostel,
  type ManagedHostel,
  RESIDENT_TYPES,
  type ResidentType,
} from "@/lib/admin-manage-api";
import { readApiError } from "@/lib/api-contract";
import { formatMoney, humanizeEnum } from "@/lib/format";
import { dayInputFromNow, startOfDayIso } from "@/lib/manage-dates";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Admitting somebody — the one action on the roster that changes the building.
 *
 * ## It takes a bed
 *
 * Registering decrements `vacantBeds` on the chosen room type, so the picker
 * below shows what is actually free and a full type is not offered. The server
 * checks again, of course; showing the count here is what stops the form being
 * filled in for a room that has been gone since breakfast.
 *
 * ## The fee is prefilled from the room type, and is still an override
 *
 * `monthlyFee` on a resident is a per-person override. Prefilling it from the
 * room's rent is what an intake actually wants — you agreed a number at the door
 * — but leaving it at zero is *not* "use the schedule": zero is a free stay.
 * That distinction is spelled out on the field, and clearing an override later
 * lives on the resident's own screen.
 *
 * ## The referral code has one chance
 *
 * If this person came through a resident's code, it is entered here or never:
 * the link is made at creation and there is no route that attaches one
 * afterwards. That is why it is on the first screen rather than hidden behind
 * "advanced".
 */

const TYPE_OPTIONS = RESIDENT_TYPES.map((value) => ({
  label: humanizeEnum(value),
  value,
}));

export default function NewResidentScreen() {
  const hostel = useResource<ManagedHostel>(useCallback(() => getManagedHostel(), []));

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [roomType, setRoomType] = useState<string | null>(null);
  const [residentType, setResidentType] = useState<ResidentType>("STUDENT");
  const [moveInDate, setMoveInDate] = useState(() => dayInputFromNow(0));
  const [monthlyFee, setMonthlyFee] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [activeNow, setActiveNow] = useState(true);
  const [saving, setSaving] = useState(false);

  const rooms = useMemo(
    () => (hostel.data?.roomConfigurations ?? []).filter((config) => config.vacantBeds > 0),
    [hostel.data],
  );

  const chosen = rooms.find((config) => config.roomType === roomType) ?? null;

  const pickRoom = useCallback(
    (value: string) => {
      setRoomType(value);

      const config = (hostel.data?.roomConfigurations ?? []).find(
        (entry) => entry.roomType === value,
      );

      // Only when the admin has not typed their own figure — an agreed rent
      // that the room picker then overwrites is worse than no prefill at all.
      if (config?.monthlyRent && !monthlyFee.trim()) {
        setMonthlyFee(String(config.monthlyRent));
      }
    },
    [hostel.data, monthlyFee],
  );

  const submit = useCallback(async () => {
    if (firstName.trim().length < 1 || lastName.trim().length < 1) {
      toastError("Name them", "Both names, as they would write them.");
      return;
    }

    if (phone.trim().length < 7) {
      toastError("Check the phone", "It is how the hostel reaches them.");
      return;
    }

    if (!roomType) {
      toastError("Pick a room type", "Admitting somebody takes a bed off one of them.");
      return;
    }

    const iso = startOfDayIso(moveInDate);

    if (!iso) {
      toastError("Check the move-in date", "Write it as YYYY-MM-DD.");
      return;
    }

    setSaving(true);

    try {
      const resident = await createResident({
        depositAmount: depositAmount.trim() ? Number(depositAmount) : 0,
        email: email.trim() || undefined,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        monthlyFee: monthlyFee.trim() ? Number(monthlyFee) : 0,
        moveInDate: iso,
        phone: phone.trim(),
        referralCode: referralCode.trim() || undefined,
        residentType,
        roomType,
        status: activeNow ? "ACTIVE" : "PENDING",
      });

      toastSuccess(
        "Registered",
        "Issue their activation code next so they can sign in.",
      );
      router.replace(`/manage/resident/${resident.id}`);
    } catch (error) {
      toastError("Could not register", readApiError(error, "That did not save."));
    } finally {
      setSaving(false);
    }
  }, [
    activeNow,
    depositAmount,
    email,
    firstName,
    lastName,
    monthlyFee,
    moveInDate,
    phone,
    referralCode,
    residentType,
    roomType,
  ]);

  if (hostel.loading) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="New resident" />}>
        <LoadingState label="Checking which beds are free" />
      </Screen>
    );
  }

  if (hostel.error || !hostel.data) {
    return (
      <Screen header={<AppBar accent centerTitle showBack title="New resident" />}>
        <ErrorState message={hostel.error ?? "No hostel"} onRetry={hostel.reload} />
      </Screen>
    );
  }

  return (
    <Screen
      footer={<Button label="Register them" loading={saving} onPress={() => void submit()} />}
      header={<AppBar accent centerTitle showBack subtitle={hostel.data.name} title="New resident" />}
      scroll
    >
      <View className="gap-5 pt-1">
        <View>
          <SectionHeader title="Who they are" />
          <Card className="gap-3">
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Input
                  autoCapitalize="words"
                  label="First name"
                  onChangeText={setFirstName}
                  value={firstName}
                />
              </View>
              <View className="flex-1">
                <Input
                  autoCapitalize="words"
                  label="Last name"
                  onChangeText={setLastName}
                  value={lastName}
                />
              </View>
            </View>

            <Input
              hint="One phone number per resident — a number already on the roll is refused."
              keyboardType="phone-pad"
              label="Phone"
              onChangeText={setPhone}
              value={phone}
            />

            <Input
              autoCapitalize="none"
              hint="Their activation code and receipts go here. Optional, but without it every code has to be read out loud."
              keyboardType="email-address"
              label="Email"
              onChangeText={setEmail}
              value={email}
            />

            <Select
              label="They are a"
              onChange={setResidentType}
              options={TYPE_OPTIONS}
              value={residentType}
            />
          </Card>
        </View>

        <View>
          <SectionHeader
            subtitle="Only types with a free bed are shown"
            title="Where they sleep"
          />
          <Card className="gap-3">
            {rooms.length === 0 ? (
              <Text variant="muted">
                Every room type is full. Free a bed by moving somebody out, or add
                capacity on the Rooms screen.
              </Text>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                {rooms.map((config) => (
                  <Chip
                    icon="bed-outline"
                    key={config.roomType}
                    label={`${config.roomType} · ${config.vacantBeds} free`}
                    onPress={() => pickRoom(config.roomType)}
                    tone={roomType === config.roomType ? "brand" : "neutral"}
                  />
                ))}
              </View>
            )}

            {chosen?.monthlyRent ? (
              <Text variant="caption">
                {`${chosen.roomType} is listed at ${formatMoney(chosen.monthlyRent)} a month, meals ${chosen.mealInclusion.toLowerCase()}.`}
              </Text>
            ) : null}

            <Input
              keyboardType="numbers-and-punctuation"
              label="Moving in on"
              onChangeText={setMoveInDate}
              placeholder="YYYY-MM-DD"
              value={moveInDate}
            />

            <View className="flex-row flex-wrap gap-2">
              <Chip label="Today" onPress={() => setMoveInDate(dayInputFromNow(0))} />
              <Chip label="Tomorrow" onPress={() => setMoveInDate(dayInputFromNow(1))} />
              <Chip label="Next week" onPress={() => setMoveInDate(dayInputFromNow(7))} />
            </View>

            <View className="flex-row items-center justify-between gap-3 border-t border-border pt-3">
              <View className="flex-1">
                <Text variant="label">{activeNow ? "Living here" : "Not yet arrived"}</Text>
                <Text variant="caption">
                  {activeNow
                    ? "Counted in occupancy and billed from the move-in date."
                    : "Held as pending until you mark them active."}
                </Text>
              </View>
              <Toggle
                accessibilityLabel="Resident is already living here"
                onChange={setActiveNow}
                value={activeNow}
              />
            </View>
          </Card>
        </View>

        <View>
          <SectionHeader title="Money" />
          <Card className="gap-3">
            <Input
              hint="A per-person figure. Zero means a deliberate free stay, not “use the fee schedule” — that is cleared later on their own screen."
              keyboardType="number-pad"
              label="Monthly fee (NPR)"
              onChangeText={setMonthlyFee}
              value={monthlyFee}
            />
            <Input
              hint="What you are holding. It comes back through the move-out checklist."
              keyboardType="number-pad"
              label="Deposit taken (NPR)"
              onChangeText={setDepositAmount}
              value={depositAmount}
            />
          </Card>
        </View>

        <View>
          <SectionHeader
            subtitle="Only enterable now — there is no route that attaches one later"
            title="Referred by"
          />
          <Card>
            <Input
              autoCapitalize="characters"
              hint="The code the referring resident shared. It is what earns them their reward."
              label="Referral code"
              onChangeText={setReferralCode}
              placeholder="Optional"
              value={referralCode}
            />
          </Card>
        </View>
      </View>
    </Screen>
  );
}
