import "server-only";

import { bookingPolicyVersion } from "@/modules/bookings/booking-code";
import { getBookingConfig } from "@/modules/bookings/booking-config";
import {
  fillPolicyText,
  policyValues,
  refundPolicyIntro,
  refundPolicySections,
  type PolicySection,
} from "@/modules/bookings/booking-policy";
import { termsFromConfig } from "@/modules/bookings/booking-terms";
import { getSiteConfigSection } from "@/modules/platform-config/site-config.service";

export type RefundPolicy = {
  /** Website Config → Legal text with the live numbers filled in, when an owner wrote one. */
  customBody: string | null;
  intro: string[];
  sections: PolicySection[];
  updatedAt: string;
  /** The same version the checkout sends back, so a screen can tell the policy moved. */
  version: string;
};

export async function getRefundPolicy(): Promise<RefundPolicy> {
  const [config, legal] = await Promise.all([getBookingConfig(), getSiteConfigSection("legal")]);
  const body = legal.refund.body.trim();

  return {
    customBody: body ? fillPolicyText(body, policyValues(config)) : null,
    intro: refundPolicyIntro(),
    sections: refundPolicySections(config),
    updatedAt: legal.refund.updatedAt,
    version: bookingPolicyVersion(termsFromConfig(config), legal.refund),
  };
}
