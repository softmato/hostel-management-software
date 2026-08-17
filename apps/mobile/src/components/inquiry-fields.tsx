import { View } from "react-native";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { InquiryDraft, InquiryErrors } from "@/lib/inquiry-form";

/**
 * The four fields, shared by both inquiry screens.
 *
 * There are two ways to send one: `hostel/[slug]/inquiry`, which posts to the
 * hostel's own route, and `ref/[code]`, which posts to
 * `/public/inquiries/with-referral` and lets the code pick the hostel. They
 * differ in **which function they call and what they say above the form** —
 * nothing else. Keeping the fields in one component is what stops the
 * validation, the placeholders and the keyboard types drifting apart between
 * two forms that must behave identically.
 *
 * Validation stays in `lib/inquiry-form.ts`: this renders errors, it does not
 * decide them.
 */
export function InquiryFields({
  busy,
  draft,
  errors,
  onChange,
}: {
  busy: boolean;
  draft: InquiryDraft;
  errors: InquiryErrors;
  onChange: (patch: Partial<InquiryDraft>) => void;
}) {
  return (
    <Card className="gap-4">
      <View className="gap-4">
        <Input
          autoCapitalize="words"
          editable={!busy}
          error={errors.name}
          label="Your name"
          onChangeText={(name) => onChange({ name })}
          placeholder="Sita Rai"
          value={draft.name}
        />

        <Input
          editable={!busy}
          error={errors.phone}
          hint="How the hostel will reach you."
          inputMode="tel"
          keyboardType="phone-pad"
          label="Phone"
          onChangeText={(phone) => onChange({ phone })}
          placeholder="98XXXXXXXX"
          value={draft.phone}
        />

        <Input
          autoCapitalize="none"
          editable={!busy}
          error={errors.email}
          hint="Optional."
          inputMode="email"
          keyboardType="email-address"
          label="Email"
          onChangeText={(email) => onChange({ email })}
          placeholder="you@example.com"
          value={draft.email}
        />

        <Input
          editable={!busy}
          error={errors.message}
          hint="When you'd move in, how many sharing, anything you need to know."
          label="Message"
          multiline
          onChangeText={(message) => onChange({ message })}
          placeholder="Hi — is a two-sharing room free from Bhadra?"
          value={draft.message}
        />
      </View>
    </Card>
  );
}
