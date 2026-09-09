import { z } from "zod";

import { platformHostelCreateSchema } from "@/modules/hostels/hostel.validation";

/**
 * The one shape a hostel registration has, whichever desk it arrives at.
 *
 * Two forms post it: the public one an owner fills in themselves, and the team
 * one a field agent fills in sitting with that owner. They ask for the same
 * facts because they *are* the same facts — a hostel does not have a different
 * number of beds depending on who typed it in — and a single schema is what
 * stops the two drifting into asking for different things and storing different
 * subsets.
 *
 * ## What this fixes on the way past
 *
 * The public form has always collected an alternate phone, a landmark, a map
 * link, a year established and a total capacity, and posted all five. The old
 * schema declared none of them, so zod stripped them silently and they reached
 * the database as nothing at all. They are declared here, and the model now has
 * somewhere to put them.
 *
 * ## Why the plan is optional
 *
 * The two desks choose a plan at different moments, and both are deliberate:
 *
 * - **Public** — no plan at submission. The owner picks one later, from the
 *   progress page, and may do so before verification finishes so that paying is
 *   a single click the moment it does.
 * - **Team** — the plan is a step *inside* the form, because the agent is with
 *   the owner and about to take money for it.
 *
 * So `plan` is absent on one path and present on the other, which is an
 * optional field rather than two schemas. The registration service, not the
 * schema, decides what a missing plan means for each source.
 */

/** Discounted cycles, matching the plans catalogue's own three. */
export const billingCycleSchema = z.enum(["monthly", "halfYearly", "annual"]);

export const registrationPlanChoiceSchema = z.object({
  cycle: billingCycleSchema.default("monthly"),
  /** Catalogue id. Validated against the live catalogue in the service. */
  planId: z.string().trim().min(1).max(40),
});

/**
 * Who is applying.
 *
 * `email` stays optional because a team agent may be registering a hostel whose
 * owner does not use email — the agent's own contact details reach us anyway,
 * through the account that filed it. Everything the old schema demanded is
 * still demanded.
 */
const applicantSchema = z.object({
  /** Kept as text: it is a stated age, not a computed one, and may be blank. */
  age: z.string().trim().max(3).optional(),
  email: z.string().trim().email().optional(),
  gender: z.enum(["Male", "Female", "Other"]).optional(),
  /** Which government ID was uploaded, so the reviewer knows what to expect. */
  idProofType: z.string().trim().max(80).optional(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(24),
});

export const hostelRegistrationSchema = platformHostelCreateSchema
  .omit({ ownerId: true })
  .extend({
    /** A second number to try. Collected by both forms, stored on the hostel. */
    alternatePhone: z.string().trim().min(7).max(24).optional(),
    applicant: applicantSchema,
    /** How many cooks the kitchen runs. Informs the plan's seat caps. */
    cookCount: z.coerce.number().int().min(0).max(100).optional(),
    /** "Opposite the campus gate" — how directions are actually given here. */
    landmark: z.string().trim().max(240).optional(),
    /**
     * A maps link, stored as pasted. Not parsed into coordinates: a shortened
     * `maps.app.goo.gl` cannot be resolved without a network call, and what the
     * owner actually handed us is the honest thing to keep.
     */
    mapLink: z.string().trim().max(500).optional(),
    plan: registrationPlanChoiceSchema.optional(),
    /** Beds across the whole building, as stated. */
    totalCapacity: z.coerce.number().int().min(0).max(10_000).optional(),
    yearEstablished: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "Year established should be four digits.")
      .optional(),
  });

export type HostelRegistrationInput = z.infer<typeof hostelRegistrationSchema>;
export type RegistrationPlanChoice = z.infer<typeof registrationPlanChoiceSchema>;

/**
 * The team form's post.
 *
 * Same body, plus what the agent collected. The payment is part of the
 * submission rather than a step after it because the money and the paperwork
 * happen in the same conversation — and because an agent who submitted the form
 * and then lost signal before recording the cash would leave a published hostel
 * with no trace of the money that was handed over.
 *
 * `amount` may legitimately be **zero**: an agent is allowed to file a hostel
 * and collect nothing that day. Zero is not a payment, so no payment row is
 * written for it — the whole plan price simply becomes the due.
 */
export const teamHostelRegistrationSchema = hostelRegistrationSchema.extend({
  payment: z.object({
    /** Whole rupees actually taken. Zero means nothing was collected. */
    amount: z.coerce.number().int().min(0).max(10_000_000),
    /**
     * `SOFTMATO` opens a checkout the owner completes themselves; it settles
     * later, on a webhook. `CASH` is money already in the agent's hand and
     * settles on submission.
     */
    method: z.enum(["SOFTMATO", "CASH"]),
    /** Kept for cash: a slip number the agent wrote down. */
    reference: z.string().trim().max(120).optional(),
  }),
  /** The team form always names a plan — it is a step in the form. */
  plan: registrationPlanChoiceSchema,
});

export type TeamHostelRegistrationInput = z.infer<typeof teamHostelRegistrationSchema>;
