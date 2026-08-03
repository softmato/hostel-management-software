"use client";

import { useQuery } from "@tanstack/react-query";

import { checkOnly } from "@/components/talk-to-expert";

export type MyExpertConsultationRequest = {
  budgetRange: string | null;
  createdAt: string | null;
  environment: string | null;
  id: string;
  likedSpots: string | null;
  preferredCollege: string | null;
};

/**
 * The visitor's own latest "Talk to an Expert" answers, if any. Not signed in
 * and not-yet-answered both resolve to `null` here — never a thrown error —
 * so a page can show its own CTA instead of a broken panel.
 */
export function useMyExpertConsultationRequest() {
  return useQuery({
    queryFn: async () => {
      const { data } = await checkOnly<{ request: MyExpertConsultationRequest | null }>(
        "/api/v1/users/expert-consultation-requests",
      );
      return data?.request ?? null;
    },
    queryKey: ["my-expert-consultation-request"],
  });
}
