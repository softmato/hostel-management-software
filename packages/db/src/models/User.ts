import { Schema, model, models } from "mongoose";

import { ROLE_VALUES } from "@hostel/shared/types/roles";
import { AuthProvider } from "@hostel/shared/types/enums";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    image: { type: String, default: null },
    emailVerified: { type: Boolean, default: false },
    emailVerifiedAt: Date,
    phone: { type: String, trim: true },
    phoneVerifiedAt: Date,
    passwordHash: { type: String, select: false },
    authProvider: {
      type: String,
      enum: Object.values(AuthProvider),
      default: AuthProvider.LOCAL,
    },
    googleId: { type: String, trim: true },
    /**
     * Public, shareable handle for this person's platform-wide resident
     * identity (format `HH-XXXX-XXXX`). A hostel warden types it in — or scans
     * the user's QR — to pull the encrypted profile in UserResidentProfile
     * instead of re-typing every personal detail by hand. Minted lazily the
     * first time the user saves a resident profile, so most accounts have none.
     */
    userResidentId: { type: String, trim: true, uppercase: true },
    role: { type: String, enum: ROLE_VALUES, required: true },
    mustChangePassword: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    hostelIds: [{ ref: "Hostel", type: Schema.Types.ObjectId }],
    status: {
      type: String,
      enum: ["ACTIVE", "INVITED", "SUSPENDED", "ARCHIVED"],
      default: "ACTIVE",
    },
    lastLoginAt: Date,
    createdBy: { ref: "User", type: Schema.Types.ObjectId },
    updatedBy: { ref: "User", type: Schema.Types.ObjectId },
    isDemoData: { type: Boolean, default: false },
    demoDataLabel: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false },
    deletedAt: Date,
    deletedBy: { ref: "User", type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { sparse: true, unique: true });
userSchema.index({ phone: 1 }, { sparse: true, unique: true });
userSchema.index({ googleId: 1 }, { sparse: true, unique: true });
userSchema.index({ userResidentId: 1 }, { sparse: true, unique: true });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ hostelIds: 1, status: 1 });

export const UserModel = models.User || model("User", userSchema);
