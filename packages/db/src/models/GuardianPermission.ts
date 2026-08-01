import { Schema, model, models } from "mongoose";

const guardianPermissionSchema = new Schema(
  {
    hostelId: { ref: "Hostel", required: true, type: Schema.Types.ObjectId },
    residentId: { ref: "Resident", required: true, type: Schema.Types.ObjectId },
    guardianAccessId: {
      ref: "GuardianAccess",
      required: true,
      type: Schema.Types.ObjectId,
    },
    // Every field defaults to false: a guardian sees what the resident
    // deliberately switched on, and nothing else (PRD.md §10).
    canViewPayments: { default: false, type: Boolean },
    canViewReceipts: { default: false, type: Boolean },
    canViewNotices: { default: false, type: Boolean },
    canViewFood: { default: false, type: Boolean },
    canViewSafety: { default: false, type: Boolean },
    canViewComplaintStatus: { default: false, type: Boolean },
  },
  { timestamps: true },
);

guardianPermissionSchema.index({ guardianAccessId: 1 }, { unique: true });
guardianPermissionSchema.index({ hostelId: 1, residentId: 1 });

export const GuardianPermissionModel =
  models.GuardianPermission || model("GuardianPermission", guardianPermissionSchema);
