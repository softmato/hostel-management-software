import { Schema, model, models } from "mongoose";

/**
 * What a resident says about their own night — one current row each.
 *
 * ## `night` is what makes an answer expire
 *
 * The row is upserted and never deleted, so without a night key "her status is
 * INSIDE_HOSTEL" is true forever after the one evening she tapped it. The app
 * papered over that client-side by comparing `checkedAt` against a 17:00
 * boundary it kept to itself; the warden board did not, and showed a hostel
 * full of residents marked present on the strength of answers given weeks ago.
 *
 * So the night an answer belongs to is now **stored** rather than derived by
 * whoever happens to be reading. `night` is `YYYY-MM-DD` from
 * `nightKey()` in `@hostel/night/night-window` — the 17:00-to-17:00 key, so an
 * answer at 23:30 and a board read at 00:30 agree about which night they mean.
 * A row whose `night` is not tonight's reads as `NOT_VERIFIED`, which is the
 * honest answer: they have not told us anything about *tonight*.
 *
 * Deliberately a stored string rather than a recomputation from `checkedAt` at
 * read time. Both would work today; only one of them still works after somebody
 * writes a second reader — and there are already three.
 *
 * ## The reason is optional and it stays optional
 *
 * `reasonCode` is one of the presets the notification and the screen offer;
 * `note` is whatever they typed. Neither is required to record `OUTSIDE_HOSTEL`.
 * `docs/DESIGN.md` is explicit that being out is neutral rather than a warning,
 * and a product that refuses "not in tonight" without an explanation teaches
 * people to stop answering rather than to explain themselves.
 */
const nightStatusSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    status: {
      enum: [
        "INSIDE_HOSTEL",
        "OUTSIDE_HOSTEL",
        "NOT_VERIFIED",
        "MARKED_SAFE",
        "SOS_TRIGGERED",
      ],
      required: true,
      type: String,
    },
    checkedAt: { default: Date.now, type: Date },
    /**
     * The night this answer is about — `YYYY-MM-DD`, from `nightKey()`.
     *
     * Optional in the schema on purpose: every row written before this field
     * existed has none, and those rows must read as "no answer for tonight"
     * rather than crash a board or, far worse, match a night by accident. A
     * missing value is never equal to tonight's key, so the old rows age out of
     * relevance on their own the first evening anybody answers again.
     */
    night: { type: String },
    /** One of the hostel's presets, when they tapped one instead of typing. */
    reasonCode: {
      enum: ["HOME", "FRIENDS", "TRAVELLING", "WORKING_LATE", "HOSPITAL", "OTHER"],
      type: String,
    },
    note: { trim: true, type: String },
    source: {
      default: "RESIDENT",
      enum: ["RESIDENT", "WARDEN_OVERRIDE", "SOS"],
      type: String,
    },
    updatedBy: { ref: "User", required: true, type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

nightStatusSchema.index({ residentId: 1 }, { unique: true });
nightStatusSchema.index({ hostelId: 1, status: 1, checkedAt: -1 });
/** The warden board and the prompt's "who has not answered tonight" pass. */
nightStatusSchema.index({ hostelId: 1, night: 1 });

export const NightStatusModel =
  models.NightStatus || model("NightStatus", nightStatusSchema);
