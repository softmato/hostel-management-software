"use client";

import { Star } from "lucide-react";
import { memo, useCallback, useState, type FormEvent } from "react";

import { BusyForm, SubmitButton } from "@/app/_components/busy-form";
import { browserApi } from "@/lib/browser-api";
import { field, Message, optionalNumber, PageHeader } from "./daily-operations-shared";
import { Input, Panel, TextArea } from "@/app/_components/shared-ui";

export const ResidentReviewsPageContent = memo(function ResidentReviewsPageContent() {
  const [message, setMessage] = useState("");

  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);

    try {
      await browserApi("/api/v1/resident/reviews", {
        body: JSON.stringify({
          cleanlinessRating: optionalNumber(form, "cleanlinessRating"),
          comment: field(form, "comment"),
          foodRating: optionalNumber(form, "foodRating"),
          overallRating: optionalNumber(form, "overallRating"),
          safetyRating: optionalNumber(form, "safetyRating"),
        }),
        method: "POST",
      });
      setMessage("Review submitted.");
      formElement.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit review.");
    }
  }, []);

  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      <PageHeader description="Verified hostel review." icon={Star} title="Reviews" />
      <Message value={message} />
      <Panel>
        <BusyForm className="grid gap-3" onSubmit={submit}>
          <Input label="Overall rating" name="overallRating" required type="number" />
          <Input label="Food rating" name="foodRating" type="number" />
          <Input label="Safety rating" name="safetyRating" type="number" />
          <Input label="Cleanliness rating" name="cleanlinessRating" type="number" />
          <TextArea label="Comment" name="comment" />
          <SubmitButton className="h-11 rounded-md bg-role-resident text-sm font-semibold text-white">
            Submit Review
          </SubmitButton>
        </BusyForm>
      </Panel>
    </div>
  );
});
