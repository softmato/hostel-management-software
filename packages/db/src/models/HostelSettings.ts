import { Schema, model, models } from "mongoose";

/**
 * Per-hostel operational settings (ARCHITECTURE.md §5, second level of the
 * PlatformConfig → HostelSettings hierarchy). One document per hostel.
 */
const hostelSettingsSchema = new Schema(
  {
    hostelId: {
      ref: "Hostel",
      required: true,
      type: Schema.Types.ObjectId,
      unique: true,
    },
    cookPortalEnabled: { default: false, type: Boolean },
    cookName: { trim: true, type: String },
    cookUserId: { ref: "User", type: Schema.Types.ObjectId },
    /**
     * When the current shared cook password was issued. Only the bcrypt hash is
     * ever stored, so this timestamp (plus the account's `mustChangePassword`
     * flag) is what the dashboard shows in place of the password itself.
     */
    cookCredentialIssuedAt: Date,
    /**
     * Geofence + attendance configuration (PHASES.md §4.1). Radii are metres
     * from the hostel's own coordinates. The platform sets the ceilings; a
     * hostel admin tunes within them.
     */
    attendance: {
      type: {
        /** Absence streak (days) that raises an AttendanceAlert. */
        absenceAlertDays: { default: 14, max: 90, min: 1, type: Number },
        enabled: { default: false, type: Boolean },
        insideZoneRadiusMeters: { default: 50, max: 500, min: 10, type: Number },
        nearbyZoneRadiusMeters: { default: 200, max: 2000, min: 20, type: Number },
        /** How long raw AttendanceLog rows are kept before the purge job. */
        retentionDays: { default: 600, max: 1095, min: 30, type: Number },
        /** Local times (HH:mm) the mobile app is expected to ping at. */
        pingTimes: { default: ["06:00", "08:00", "22:00"], type: [String] },
        /**
         * The nightly "are you in tonight?" prompt.
         *
         * ## Why it lives under `attendance` and not beside it
         *
         * Because this is the settings block a warden opens when they want to
         * change anything about how the hostel tracks who is in. Splitting the
         * prompt into a sibling block would mean two screens, two endpoints and
         * two chances for a hostel to have the geofence on and the prompt off
         * without anybody noticing the difference — and the two answer the same
         * question by different means.
         *
         * It is deliberately **one field on one document**: the app's editor and
         * the web's editor both `PATCH` the existing attendance-settings route,
         * so a warden who changes the hour on their phone has changed it on the
         * website by the time they look. That is the whole "single source"
         * requirement, and it is satisfied by not adding a second store rather
         * than by syncing two.
         */
        nightStatus: {
          type: {
            /**
             * **On by default**, and a hostel has to opt *out*.
             *
             * The opposite of how the geofence next door works, deliberately.
             * The geofence reads a resident's location whether or not they are
             * thinking about it, so it defaults off and has to be chosen. This
             * asks a question the resident answers or ignores — nothing is read,
             * nothing is inferred from silence — and a hostel that has to
             * discover a setting before anybody is ever asked is a hostel where
             * the warden keeps knocking on doors.
             *
             * `false` is stored only when somebody explicitly turns it off,
             * which is why the sender tests `$ne: false` rather than `=== true`:
             * a settings document written before this field existed has no value
             * at all, and that absence has to mean the default rather than "off".
             */
            promptEnabled: { default: true, type: Boolean },
            /**
             * `HH:mm` in Nepal. 20:00 unless the warden says otherwise.
             *
             * Bounded 17:00–23:45 by `parsePromptTime` rather than by the
             * schema, because the reason for the bound is the night boundary
             * and that reasoning belongs beside the boundary. An out-of-range
             * value here means the hostel is skipped, never that it is prompted
             * at an hour nobody chose.
             */
            promptTime: { default: "20:00", type: String },
            /**
             * Minutes after the prompt to chase whoever still has not answered.
             * `0` is off, which is the default — one notification a night is
             * the promise, and a second one has to be asked for.
             */
            remindAfterMinutes: { default: 0, max: 180, min: 0, type: Number },
          },
          default: () => ({}),
        },
      },
      default: () => ({}),
    },
    /**
     * Community feed controls (PHASES.md §5.1). Both default to the platform's
     * position: the feed is on, and the profanity mask is on — a hostel may turn
     * either off for its own residents.
     */
    community: {
      type: {
        enabled: { default: true, type: Boolean },
        profanityFilterEnabled: { default: true, type: Boolean },
      },
      default: () => ({}),
    },
    /**
     * What a call-out of each trade costs before anybody turns up.
     *
     * The figure a hostel quotes when it raises a maintenance request, so the
     * person approving it knows what they are committing to before the plumber
     * is on the phone rather than after the invoice arrives.
     *
     * **A minimum, not a price.** The real cost is whatever the job turns out to
     * be and is recorded on the request as `costNote`; this is the floor the
     * hostel has agreed with its providers. Whole rupees — every other amount in
     * the product is, and a call-out charge in paisa is not a thing anybody
     * quotes.
     *
     * An array rather than a Map keyed by category: `roomConfigurations` on the
     * hostel is already shaped this way, a Map does not survive `.lean()` as a
     * plain object, and a category with no agreed charge must be *absent* rather
     * than present at zero — zero would render as "this trade is free".
     */
    maintenance: {
      type: {
        minimumCharges: {
          default: () => [],
          type: [
            {
              _id: false,
              amount: { min: 0, required: true, type: Number },
              category: { required: true, trim: true, type: String },
            },
          ],
        },
      },
      default: () => ({}),
    },
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

export const HostelSettingsModel =
  models.HostelSettings || model("HostelSettings", hostelSettingsSchema);
