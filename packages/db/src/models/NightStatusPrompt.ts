import { Schema, model, models } from "mongoose";

/**
 * One row per "are you in tonight?" prompt a hostel has been sent.
 *
 * ## Why the prompt needs a record at all
 *
 * The job that sends it runs on a fixed external cadence (`docs/CRON.md`) and
 * the hostel's chosen minute falls *between* two runs — so the job cannot ask
 * "is it exactly 20:00", it asks "did 20:00 pass within the last little while".
 * A retried, overlapping or double-scheduled invocation answers `yes` to that
 * more than once, and without a claim every resident of the hostel is asked
 * twice. The second buzz is the one that gets the whole category muted, and a
 * muted category is a feature that has stopped existing.
 *
 * So the row is written **first** and the notifications go out only if the write
 * won: the unique index is the lock. A crash between the two loses one night's
 * prompt, which is the right way round — a resident can still answer from the
 * app, and the warden's board still shows who has not. Losing a prompt costs one
 * night of convenience; sending it twice costs the channel.
 *
 * This is the same arrangement `MealCallReminder` uses, for the same reason, and
 * the two models should stay recognisably each other's siblings.
 *
 * ## Keyed by the night, not the calendar day
 *
 * `night` is `nightKey()` from `@hostel/night/night-window` — the 17:00-to-17:00
 * key, not `nepalDayKey`. It has to be the key the *answers* are filed under, or
 * a prompt sent at 20:00 and an answer given at 00:30 belong to different nights
 * and the claim guards nothing. The `kind` discriminator keeps the optional
 * follow-up reminder from colliding with the first ask.
 *
 * Rows are disposable once the night is over; the TTL clears them so this never
 * becomes a collection anybody has to think about again.
 */
const nightStatusPromptSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    /** `YYYY-MM-DD` from `nightKey()` — the hostel's night, not UTC's day. */
    night: { required: true, type: String },
    /**
     * `PROMPT` is the one the hostel's clock triggers. `REMINDER` is the
     * optional later chase at `remindAfterMinutes`, claimed separately so
     * sending one never consumes the other's slot.
     */
    /**
     * `PROMPT` for the first round of a night, `REMINDER_<n>` for round n.
     *
     * The round lives in this string, not only in `round`, because the unique
     * index below is on `kind` and is already built in production: a plain
     * `REMINDER` for every later round would make round 2 collide with round 1
     * and silently never send. No enum, for the same reason.
     */
    kind: {
      default: "PROMPT",
      required: true,
      type: String,
    },
    /** Which round of asking this was: 0 at the hostel's hour, then 1, 2, … */
    round: { default: 0, min: 0, type: Number },
    /** The hostel's own setting at send time, quoted in the message. */
    promptTime: { trim: true, type: String },
    /** How many residents this actually reached. Read by the cron's report. */
    notifiedCount: { default: 0, min: 0, type: Number },
    sentAt: { default: Date.now, type: Date },
  },
  { timestamps: true },
);

/** The lock. A second run for the same hostel and night cannot insert. */
nightStatusPromptSchema.index({ hostelId: 1, night: 1, kind: 1 }, { unique: true });

/**
 * Swept after a week. The row's only job is to be in the way for the rest of the
 * night it was written; a few extra days makes "was the hostel prompted?" a
 * question support can answer without keeping these forever.
 */
nightStatusPromptSchema.index({ sentAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export const NightStatusPromptModel =
  models.NightStatusPrompt || model("NightStatusPrompt", nightStatusPromptSchema);
