import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { InquiryFields } from "@/components/inquiry-fields";
import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { useAppSelector } from "@/hooks/redux";
import { readApiError } from "@/lib/api-contract";
import {
  hasInquiryErrors,
  type InquiryErrors,
  normalizePhone,
  validateInquiry,
} from "@/lib/inquiry-form";
import { sendHostelInquiry } from "@/lib/public-api";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * "Ask this hostel about a room."
 *
 * An **inquiry**, not a booking — and the copy says so. The server has no
 * booking model, no availability hold and no confirmation; this sends a message
 * a human reads. The mockup's "Book a Visit" button would promise a reserved
 * bed the product cannot deliver, and the complaint that follows is the hostel's
 * to field.
 *
 * Prefilled from the signed-in account where there is one, because a
 * `PUBLIC_USER` browsing hostels has already told us their name and phone once.
 */
export default function HostelInquiryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const account = useAppSelector((state) => state.auth.account);

  const [draft, setDraft] = useState({
    email: account?.email ?? "",
    message: "",
    name: account?.name ?? "",
    phone: account?.phone ?? "",
  });
  const [errors, setErrors] = useState<InquiryErrors>({});
  const [busy, setBusy] = useState(false);

  const patch = useCallback((next: Partial<typeof draft>) => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  const submit = useCallback(async () => {
    const found = validateInquiry(draft);

    setErrors(found);

    if (hasInquiryErrors(found)) {
      return;
    }

    setBusy(true);

    try {
      await sendHostelInquiry(slug, {
        email: draft.email.trim() || undefined,
        message: draft.message.trim() || undefined,
        name: draft.name.trim(),
        phone: normalizePhone(draft.phone),
      });

      toastSuccess("Inquiry sent", "The hostel will get back to you directly.");
      router.back();
    } catch (caught) {
      toastError("Could not send that", readApiError(caught));
    } finally {
      setBusy(false);
    }
  }, [draft, slug]);

  return (
    <Screen
      footer={
        <Button label="Send inquiry" loading={busy} onPress={() => void submit()} />
      }
      header={<AppBar showBack title="Ask about a room" />}
      scroll
    >
      <View className="gap-4 pt-1">
        <Card>
          <Text variant="muted">
            This sends your details straight to the hostel. They reply to you
            directly — it does not reserve a bed.
          </Text>
        </Card>

        <InquiryFields busy={busy} draft={draft} errors={errors} onChange={patch} />
      </View>
    </Screen>
  );
}
