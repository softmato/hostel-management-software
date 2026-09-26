import { NextResponse, type NextRequest } from "next/server";

import {
  emailFromPreferenceToken,
  getMutedTopics,
  mutedAfterForm,
  setMutedTopics,
} from "@/modules/notifications/email-preference.service";
import { isEmailTopic } from "@/modules/notifications/email-topics";

export const runtime = "nodejs";

/**
 * The `/email-preferences` page's form. A plain HTML POST, so it works from any
 * mail client's browser with no JavaScript, answered with a 303 back to the page.
 *
 * `mute` is the page's single "Unsubscribe" button; otherwise `shown` lists the
 * topics the form rendered and `receive` the ones left ticked. The signed token
 * is the whole authorisation — it names one address and can only change that
 * address's optional mail.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const topic = form.get("topic");
  const back = new URL("/email-preferences", request.url);

  back.searchParams.set("token", token);

  if (isEmailTopic(topic)) {
    back.searchParams.set("topic", topic);
  }

  const email = emailFromPreferenceToken(token);

  if (!email) {
    return NextResponse.redirect(back, 303);
  }

  try {
    const current = await getMutedTopics(email);
    const mute = form.get("mute");

    await setMutedTopics(
      [email],
      isEmailTopic(mute)
        ? [...current, mute]
        : mutedAfterForm(
            current,
            form.getAll("shown").filter(isEmailTopic),
            form.getAll("receive").filter(isEmailTopic),
          ),
    );
    back.searchParams.set("saved", "1");
  } catch {
    back.searchParams.set("error", "1");
  }

  return NextResponse.redirect(back, 303);
}
