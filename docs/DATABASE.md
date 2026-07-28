# DATABASE.md — Schema & Relationships

Database: **MongoDB**. ODM: **Mongoose**. Schemas live at `packages/db/src/models/`. Models below are written Mongoose-style with TypeScript interfaces.

## Conventions

- All primary keys: `_id ObjectId` (Mongoose default)
- All models: `createdAt: Date`, `updatedAt: Date` (via `timestamps: true`)
- Soft-delete only where explicitly noted (`deletedAt?: Date`); everything else is a hard delete guarded by role checks
- Every hostel-scoped model has a **mandatory, indexed** `hostelId: ObjectId` — this is the tenant-isolation key (see ARCHITECTURE.md §2)
- Money fields: `Decimal128` (never `Number`), currency assumed NPR platform-wide (no multi-currency in v1)
- Enums: TypeScript string literal unions, validated via Mongoose enum

---

## Enums

```typescript
export enum Role {
  SUPERADMIN = 'SUPERADMIN',
  PLATFORM_MODERATOR = 'PLATFORM_MODERATOR',
  HOSTEL_ADMIN = 'HOSTEL_ADMIN',
  WARDEN = 'WARDEN',
  COOK = 'COOK',
  RESIDENT = 'RESIDENT',
  GUARDIAN = 'GUARDIAN',
  PUBLIC = 'PUBLIC',
}

export enum AuthProvider {
  LOCAL = 'LOCAL',
  GOOGLE = 'GOOGLE',
}

export enum HostelStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

export enum VerificationStatus {
  UNVERIFIED = 'UNVERIFIED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum RoomType {
  ONE_SEATER = 'ONE_SEATER',
  TWO_SEATER = 'TWO_SEATER',
  THREE_SEATER = 'THREE_SEATER',
  FOUR_SEATER = 'FOUR_SEATER',
  DORMITORY = 'DORMITORY',
}

export enum BedStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  RESERVED = 'RESERVED',
  UNDER_REPAIR = 'UNDER_REPAIR',
}

export enum ResidentStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  MOVED_OUT = 'MOVED_OUT',
  INACTIVE = 'INACTIVE',
}

export enum PaymentStatus {
  UNPAID = 'UNPAID',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
}

export enum PaymentMethod {
  ESEWA = 'ESEWA',
  FONEPAY = 'FONEPAY',
  KHALTI = 'KHALTI',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CASH = 'CASH',
}

export enum ProofVerificationStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

export enum NightStatusValue {
  INSIDE = 'INSIDE',
  OUTSIDE = 'OUTSIDE',
  NOT_VERIFIED = 'NOT_VERIFIED',
  SOS = 'SOS',
}

export enum NoticeCategory {
  GENERAL = 'GENERAL',
  FEE = 'FEE',
  FOOD = 'FOOD',
  RULE = 'RULE',
  EMERGENCY = 'EMERGENCY',
  MAINTENANCE = 'MAINTENANCE',
}

export enum ComplaintCategory {
  FOOD = 'FOOD',
  WATER = 'WATER',
  ROOM = 'ROOM',
  WIFI = 'WIFI',
  PAYMENT = 'PAYMENT',
  CLEANLINESS = 'CLEANLINESS',
  SECURITY = 'SECURITY',
  MAINTENANCE = 'MAINTENANCE',
  OTHER = 'OTHER',
}

export enum ComplaintStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}

export enum ServiceCategory {
  PLUMBER = 'PLUMBER',
  ELECTRICIAN = 'ELECTRICIAN',
  DOCTOR_CLINIC = 'DOCTOR_CLINIC',
  INTERNET_TECHNICIAN = 'INTERNET_TECHNICIAN',
  CLEANER = 'CLEANER',
  CARPENTER = 'CARPENTER',
  PAINTER = 'PAINTER',
  ROOM_REPAIR = 'ROOM_REPAIR',
  WATER_SUPPLIER = 'WATER_SUPPLIER',
  APPLIANCE_REPAIR = 'APPLIANCE_REPAIR',
  OTHER = 'OTHER',
}

export enum ProviderStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  HIDDEN = 'HIDDEN',
}

export enum MaintenanceStatus {
  PENDING = 'PENDING',
  CONTACTED = 'CONTACTED',
  SCHEDULED = 'SCHEDULED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum InquiryStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  CONVERTED = 'CONVERTED',
  CLOSED = 'CLOSED',
}

export enum QRStatus {
  PENDING = 'PENDING',
  ACTIVATED = 'ACTIVATED',
  EXPIRED = 'EXPIRED',
}

export enum NotificationPriority {
  INFO = 'INFO',
  NORMAL = 'NORMAL',
  URGENT = 'URGENT',
}

export enum NotificationCategory {
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  ALERT = 'ALERT',
  REMINDER = 'REMINDER',
  INFO = 'INFO',
  FOOD_READY = 'FOOD_READY',
  ATTENDANCE = 'ATTENDANCE',
  SYSTEM = 'SYSTEM',
}

export enum LocationZone {
  INSIDE = 'INSIDE',      // 0-50m from hostel (configurable)
  NEARBY = 'NEARBY',      // 51-200m from hostel (configurable)
  OUTSIDE = 'OUTSIDE',    // 201m+ from hostel
  UNKNOWN = 'UNKNOWN',    // Phone off or app closed
}

export enum CommunityPostVisibility {
  PUBLIC = 'PUBLIC',           // Visible to all residents across all hostels
  HOSTEL_ONLY = 'HOSTEL_ONLY', // Visible only to residents of same hostel
}

export enum ResidentType {
  STUDENT = 'STUDENT',
  WORKING_PROFESSIONAL = 'WORKING_PROFESSIONAL',
  OTHER = 'OTHER',
}
```

---

## Core Identity

### User

Single identity collection for every human across every role. See ARCHITECTURE.md §3.2 for the "upgrade in place" rule.

```typescript
interface IUser {
  _id: ObjectId;
  email: string; // unique, lowercase, trimmed
  emailVerified: boolean;
  passwordHash?: string; // nullable for Google-only accounts
  googleId?: string; // unique if set
  authProvider: AuthProvider;
  role: Role;
  mustChangePassword: boolean;
  isActive: boolean;
  tokenVersion: number; // bump to invalidate all refresh tokens
  // Public, shareable handle for the portable resident identity (`HH-XXXX-XXXX`).
  // Minted lazily on the user's first UserResidentProfile save, so most accounts
  // have none. Not personal data on its own — see UserResidentProfile.
  userResidentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true, 
    trim: true,
    index: true,
  },
  emailVerified: { type: Boolean, default: false },
  passwordHash: { type: String },
  googleId: { type: String, unique: true, sparse: true, index: true },
  authProvider: { 
    type: String, 
    enum: Object.values(AuthProvider), 
    required: true 
  },
  role: { 
    type: String, 
    enum: Object.values(Role), 
    default: Role.PUBLIC,
    index: true,
  },
  mustChangePassword: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
  tokenVersion: { type: Number, default: 0 },
  userResidentId: { type: String, trim: true, uppercase: true },
}, { timestamps: true });

// Indexes
UserSchema.index({ email: 1 });
UserSchema.index({ googleId: 1 }, { sparse: true });
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ userResidentId: 1 }, { sparse: true, unique: true });

export const UserModel = model<IUser>('User', UserSchema);
```

---

### UserResidentProfile

The "fill it once, reuse it everywhere" personal profile behind a user's
`userResidentId` and QR code. See PHASES.md §5A and API.md §18.

**Everything personal is one encrypted blob.** No personal field is stored as a
column, indexed, or queryable — deliberately. The only lookup key is
`User.userResidentId`, which is a random public handle, so a database dump is
useless without `PERSONAL_DATA_ENCRYPTION_KEY`.

```typescript
interface IUserResidentProfile {
  _id: ObjectId;
  userId: ObjectId; // ref User, unique
  // AES-256-GCM envelope: `v1.<iv>.<authTag>.<ciphertext>`, fresh IV per write.
  // Decrypts to the ResidentProfileData payload below.
  encryptedData: string;
  payloadVersion: number; // schema version of the decrypted payload
  completedAt?: Date; // absent until the first successful save
  shareCount: number; // bumped each time a hostel pulls this profile
  lastSharedAt?: Date;
  lastSharedWithHostelId?: ObjectId; // ref Hostel
  sharingEnabled: boolean; // user can switch sharing off without deleting
  createdBy?: ObjectId; // ref User
  updatedBy?: ObjectId; // ref User
  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: ObjectId; // ref User
  createdAt: Date;
  updatedAt: Date;
}

// The decrypted shape of `encryptedData`. Never persisted in the clear.
// Every field feeds something that already exists downstream:
interface ResidentProfileData {
  // → Resident
  fullName: string;
  primaryPhone: string;
  primaryEmail: string;      // the account email
  occupation: 'STUDENT' | 'WORKING_PROFESSIONAL' | 'OTHER';
  // → Inquiry, and BOYS/GIRLS/CO_LIVING matching
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY';
  budgetRange?: string;
  // → SOSAlert + safety handling
  bloodGroup: 'A+'|'A-'|'B+'|'B-'|'AB+'|'AB-'|'O+'|'O-'|'UNKNOWN';
  medicalNotes?: string;
  // → Guardian (email is how the guardian-portal invite is sent)
  guardianName: string;
  guardianRelation: string;
  guardianPhone: string;
  guardianEmail?: string;
  secondGuardianName?: string;
  secondGuardianRelation?: string;
  secondGuardianPhone?: string;
  secondGuardianEmail?: string;
  // → EmergencyContact (falls back to the primary guardian when blank)
  emergencyContactName?: string;
  emergencyContactRelation?: string;
  emergencyContactPhone?: string;
  // → MoveInChecklist.documentsCollected
  governmentIdType?: 'CITIZENSHIP'|'PASSPORT'|'DRIVING_LICENSE'|'STUDENT_ID'|'NATIONAL_ID'|'OTHER';
  governmentIdNumber?: string;
  // → Hostel.food (veg / non-veg service planning)
  dietaryPreference: 'NO_PREFERENCE'|'VEG'|'NON_VEG'|'EGGETARIAN'|'VEGAN';
  // → the "educationInfo" named in PHASES.md §2.1
  institution?: string;
  courseOrDesignation?: string;
  // Supporting detail
  dateOfBirth?: string;      // YYYY-MM-DD; `age` is derived on read, never stored
  alternatePhone?: string;
  backupEmail?: string;      // at most two emails total, must differ from primaryEmail
  permanentAddress?: string;
  city?: string;
  province?: string;
  interests: string[];       // max 12, de-duplicated
}

const UserResidentProfileSchema = new Schema<IUserResidentProfile>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  encryptedData: { type: String, required: true },
  payloadVersion: { type: Number, default: 1 },
  completedAt: { type: Date },
  shareCount: { type: Number, default: 0, min: 0 },
  lastSharedAt: { type: Date },
  lastSharedWithHostelId: { type: Schema.Types.ObjectId, ref: 'Hostel' },
  sharingEnabled: { type: Boolean, default: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

UserResidentProfileSchema.index({ userId: 1 }, { unique: true });

export const UserResidentProfileModel =
  model<IUserResidentProfile>('UserResidentProfile', UserResidentProfileSchema);
```

**Deliberately absent:** room, bed, deposit, move-in date. Those are the warden's
call per hostel, not portable facts about a person, and live on `Resident`.

**Key rotation warning:** changing `PERSONAL_DATA_ENCRYPTION_KEY` makes every
stored profile permanently unreadable. There is no re-encryption path yet.

---

## Hostel & Verification

### Hostel

Root document for each tenant.

```typescript
interface INearbyPlace {
  name: string;
  type: 'college' | 'hospital' | 'bus_stop' | 'pharmacy' | 'market' | 'other';
  distance: number; // meters
  coordinates: { lat: number; lng: number };
}

interface IHostel {
  _id: ObjectId;
  ownerId: ObjectId; // ref User
  name: string;
  type: 'boys' | 'girls' | 'co-living';
  description?: string;
  address: string;
  city: string;
  area: string;
  latitude?: number;
  longitude?: number;
  contactPhone: string;
  contactEmail?: string;
  rules?: string;
  facilities: string[]; // ['wifi', 'parking', 'gym', 'laundry', ...]
  facilityDetails?: {
    totalToilets?: number;
    parkingCapacity?: { bikes?: number; cars?: number; };
    hasGarden?: boolean;
    hasCCTV?: boolean;
    hasGenerator?: boolean;
    hasElevator?: boolean;
    hasWaterPurifier?: boolean;
    notes?: string; // additional facility notes
  };
  photos: string[]; // R2 URLs
  status: HostelStatus;
  verificationStatus: VerificationStatus;
  rejectionReason?: string;
  
  // Cached data
  nearbyPlaces: INearbyPlace[];
  nearbyPlacesLastUpdated?: Date;

  // Denormalised running total of de-duplicated public-page visits, so the
  // admin dashboard reads one number instead of aggregating HostelPageView.
  // The event rows remain authoritative for unique/recent breakdowns.
  publicViewCount: number;
  
  // Pricing (monthly per bed)
  rentPerBed?: number; // can vary by room, this is a display value
  
  createdAt: Date;
  updatedAt: Date;
}

const HostelSchema = new Schema<IHostel>({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['boys', 'girls', 'co-living'], required: true },
  description: { type: String },
  address: { type: String, required: true },
  city: { type: String, required: true, index: true },
  area: { type: String, required: true },
  latitude: { type: Number },
  longitude: { type: Number },
  contactPhone: { type: String, required: true, index: true },
  contactEmail: { type: String },
  rules: { type: String },
  facilities: [{ type: String }],
  photos: [{ type: String }],
  status: { 
    type: String, 
    enum: Object.values(HostelStatus), 
    default: HostelStatus.PENDING,
    index: true,
  },
  verificationStatus: { 
    type: String, 
    enum: Object.values(VerificationStatus), 
    default: VerificationStatus.UNVERIFIED 
  },
  rejectionReason: { type: String },
  nearbyPlaces: [{
    name: String,
    type: { type: String, enum: ['college', 'hospital', 'bus_stop', 'pharmacy', 'market', 'other'] },
    distance: Number,
    coordinates: {
      lat: Number,
      lng: Number,
    }
  }],
  nearbyPlacesLastUpdated: { type: Date },
  publicViewCount: { type: Number, default: 0, min: 0 },
  rentPerBed: { type: Number },
}, { timestamps: true });

// Indexes
HostelSchema.index({ status: 1 });
HostelSchema.index({ city: 1, type: 1 });
HostelSchema.index({ contactPhone: 1 }); // for duplicate detection
HostelSchema.index({ latitude: 1, longitude: 1 }); // for geo queries

export const HostelModel = model<IHostel>('Hostel', HostelSchema);
```

### HostelDocument

Verification documents uploaded by hostel owner.

```typescript
interface IHostelDocument {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel
  type: 'citizenship' | 'ownership_proof' | 'lease_agreement' | 'tax_clearance' | 'other';
  fileUrl: string; // R2 URL
  status: VerificationStatus;
  reviewedBy?: ObjectId; // ref User (superadmin/moderator)
  reviewedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const HostelDocumentSchema = new Schema<IHostelDocument>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  type: { 
    type: String, 
    enum: ['citizenship', 'ownership_proof', 'lease_agreement', 'tax_clearance', 'other'], 
    required: true 
  },
  fileUrl: { type: String, required: true },
  status: { 
    type: String, 
    enum: Object.values(VerificationStatus), 
    default: VerificationStatus.PENDING,
    index: true,
  },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  rejectionReason: { type: String },
}, { timestamps: true });

HostelDocumentSchema.index({ hostelId: 1, status: 1 });

export const HostelDocumentModel = model<IHostelDocument>('HostelDocument', HostelDocumentSchema);
```

### HostelStaff

Links a User (WARDEN or HOSTEL_ADMIN) to the hostel they work for, with per-warden permission flags.

```typescript
interface IHostelStaffPermissions {
  registerResidents: boolean;
  editHostelProfile: boolean;
  manageRooms: boolean;
  verifyPayments: boolean;
  manageFood: boolean;
  manageNotices: boolean;
  viewComplaints: boolean;
  updateComplaints: boolean;
  viewNightStatus: boolean;
  updateNightStatus: boolean;
  manageMaintenance: boolean;
}

interface IHostelStaff {
  _id: ObjectId;
  userId: ObjectId; // ref User, unique
  hostelId: ObjectId; // ref Hostel
  role: Role.HOSTEL_ADMIN | Role.WARDEN;
  permissions: IHostelStaffPermissions;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const HostelStaffSchema = new Schema<IHostelStaff>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  role: { 
    type: String, 
    enum: [Role.HOSTEL_ADMIN, Role.WARDEN], 
    required: true 
  },
  permissions: {
    type: {
      registerResidents: { type: Boolean, default: true },
      editHostelProfile: { type: Boolean, default: false },
      manageRooms: { type: Boolean, default: false },
      verifyPayments: { type: Boolean, default: true },
      manageFood: { type: Boolean, default: true },
      manageNotices: { type: Boolean, default: true },
      viewComplaints: { type: Boolean, default: true },
      updateComplaints: { type: Boolean, default: true },
      viewNightStatus: { type: Boolean, default: true },
      updateNightStatus: { type: Boolean, default: true },
      manageMaintenance: { type: Boolean, default: true },
    },
    default: {},
  },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

HostelStaffSchema.index({ hostelId: 1, isActive: 1 });

export const HostelStaffModel = model<IHostelStaff>('HostelStaff', HostelStaffSchema);
```

---

## Rooms & Beds

### Room

```typescript
interface IRoom {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel - MANDATORY for tenant isolation
  floor: number;
  roomNumber: string;
  type: RoomType;
  rentPerBed: number; // NPR monthly
  capacity: number; // total beds
  facilities: string[]; // ['attached_bathroom', 'cupboard', 'table', 'balcony', 'ac', 'heater']
  photos: string[]; // R2 URLs
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RoomSchema = new Schema<IRoom>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  floor: { type: Number, required: true },
  roomNumber: { type: String, required: true, trim: true },
  type: { 
    type: String, 
    enum: Object.values(RoomType), 
    required: true 
  },
  rentPerBed: { type: Number, required: true },
  capacity: { type: Number, required: true },
  facilities: [{ type: String }],
  photos: [{ type: String }],
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// Unique constraint: one roomNumber per hostel
RoomSchema.index({ hostelId: 1, roomNumber: 1 }, { unique: true });
RoomSchema.index({ hostelId: 1, isActive: 1 });

export const RoomModel = model<IRoom>('Room', RoomSchema);
```

### Bed

```typescript
interface IBed {
  _id: ObjectId;
  roomId: ObjectId; // ref Room
  hostelId: ObjectId; // denormalized for fast hostel-scoped queries
  bedLabel: string; // 'A', 'B', '1', '2', etc.
  status: BedStatus;
  maintenanceNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BedSchema = new Schema<IBed>({
  roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  bedLabel: { type: String, required: true, trim: true },
  status: { 
    type: String, 
    enum: Object.values(BedStatus), 
    default: BedStatus.AVAILABLE,
    index: true,
  },
  maintenanceNote: { type: String },
}, { timestamps: true });

// Unique constraint: one bedLabel per room
BedSchema.index({ roomId: 1, bedLabel: 1 }, { unique: true });
BedSchema.index({ hostelId: 1, status: 1 });

export const BedModel = model<IBed>('Bed', BedSchema);
```

---

## Residents & Guardians

### Resident

```typescript
interface IResident {
  _id: ObjectId;
  userId: ObjectId; // ref User, unique
  hostelId: ObjectId; // ref Hostel - MANDATORY for tenant isolation
  roomId?: ObjectId; // ref Room, nullable until assigned
  bedId?: ObjectId; // ref Bed, nullable until assigned, unique when set
  fullName: string;
  phone: string;
  guardianContact?: string;
  educationInfo?: string; // college/course
  emergencyContact?: string;
  residentType: ResidentType; // STUDENT, WORKING_PROFESSIONAL, OTHER
  moveInDate?: Date;
  moveOutDate?: Date;
  depositAmount?: number;
  status: ResidentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ResidentSchema = new Schema<IResident>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  roomId: { type: Schema.Types.ObjectId, ref: 'Room' },
  bedId: { type: Schema.Types.ObjectId, ref: 'Bed', unique: true, sparse: true }, // unique enforces one resident per bed
  fullName: { type: String, required: true, trim: true },
  phone: { type: String, required: true },
  guardianContact: { type: String },
  educationInfo: { type: String },
  emergencyContact: { type: String },
  residentType: { 
    type: String, 
    enum: Object.values(ResidentType), 
    default: ResidentType.STUDENT 
  },
  moveInDate: { type: Date },
  moveOutDate: { type: Date },
  depositAmount: { type: Number },
  status: { 
    type: String, 
    enum: Object.values(ResidentStatus), 
    default: ResidentStatus.PENDING,
    index: true,
  },
}, { timestamps: true });

ResidentSchema.index({ hostelId: 1, status: 1 });
ResidentSchema.index({ hostelId: 1, fullName: 1 });

export const ResidentModel = model<IResident>('Resident', ResidentSchema);
```

### Guardian

```typescript
interface IGuardianAccessPermissions {
  feeStatus: boolean;
  receipts: boolean;
  notices: boolean;
  foodMenu: boolean;
  nightSafety: boolean;
  complaintStatus: boolean; // if true, guardian can see complaint titles/status, not full details
}

interface IGuardian {
  _id: ObjectId;
  userId?: ObjectId; // ref User, nullable until guardian accepts invitation
  residentId: ObjectId; // ref Resident, unique - one guardian per resident
  relation: string; // 'mother', 'father', 'uncle', etc.
  phone: string;
  accessPermissions: IGuardianAccessPermissions;
  invitationToken?: string; // for initial invitation flow
  invitationExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GuardianSchema = new Schema<IGuardian>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, sparse: true, index: true },
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, unique: true, index: true },
  relation: { type: String, required: true },
  phone: { type: String, required: true },
  accessPermissions: {
    type: {
      feeStatus: { type: Boolean, default: true },
      receipts: { type: Boolean, default: false },
      notices: { type: Boolean, default: true },
      foodMenu: { type: Boolean, default: true },
      nightSafety: { type: Boolean, default: true },
      complaintStatus: { type: Boolean, default: false },
    },
    default: {},
  },
  invitationToken: { type: String, index: true, sparse: true },
  invitationExpiresAt: { type: Date },
}, { timestamps: true });

export const GuardianModel = model<IGuardian>('Guardian', GuardianSchema);
```

---

## QR Activation

```typescript
interface IQRActivation {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident, unique
  code: string; // unique 8-12 char alphanumeric
  qrImageUrl?: string; // R2 URL to generated QR image
  status: QRStatus;
  expiresAt: Date;
  activatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const QRActivationSchema = new Schema<IQRActivation>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, unique: true, index: true },
  code: { type: String, required: true, unique: true, index: true },
  qrImageUrl: { type: String },
  status: { 
    type: String, 
    enum: Object.values(QRStatus), 
    default: QRStatus.PENDING,
    index: true,
  },
  expiresAt: { type: Date, required: true, index: true },
  activatedAt: { type: Date },
}, { timestamps: true });

QRActivationSchema.index({ code: 1 });
QRActivationSchema.index({ status: 1, expiresAt: 1 });

export const QRActivationModel = model<IQRActivation>('QRActivation', QRActivationSchema);
```

---

## Payments

### Payment

```typescript
interface IPayment {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident
  hostelId: ObjectId; // denormalized for fast hostel-scoped queries
  periodMonth: Date; // first day of the billing month, e.g., 2026-08-01
  amountDue: number; // NPR
  amountPaid: number;
  status: PaymentStatus;
  dueDate: Date;
  lateFee?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  periodMonth: { type: Date, required: true },
  amountDue: { type: Number, required: true },
  amountPaid: { type: Number, default: 0 },
  status: { 
    type: String, 
    enum: Object.values(PaymentStatus), 
    default: PaymentStatus.UNPAID,
    index: true,
  },
  dueDate: { type: Date, required: true, index: true },
  lateFee: { type: Number },
  notes: { type: String },
}, { timestamps: true });

// Unique constraint: one payment per resident per month
PaymentSchema.index({ residentId: 1, periodMonth: 1 }, { unique: true });
PaymentSchema.index({ hostelId: 1, status: 1 });
PaymentSchema.index({ hostelId: 1, dueDate: 1 });

export const PaymentModel = model<IPayment>('Payment', PaymentSchema);
```

### PaymentProof

```typescript
interface IPaymentProof {
  _id: ObjectId;
  paymentId: ObjectId; // ref Payment
  residentId: ObjectId; // denormalized
  hostelId: ObjectId; // denormalized
  fileUrl: string; // R2 URL to screenshot/photo
  method: PaymentMethod;
  referenceNote?: string; // transaction ID, etc.
  verificationStatus: ProofVerificationStatus;
  verifiedBy?: ObjectId; // ref User (hostel admin/warden)
  verifiedAt?: Date;
  rejectionReason?: string;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentProofSchema = new Schema<IPaymentProof>({
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  fileUrl: { type: String, required: true },
  method: { 
    type: String, 
    enum: Object.values(PaymentMethod), 
    required: true 
  },
  referenceNote: { type: String },
  verificationStatus: { 
    type: String, 
    enum: Object.values(ProofVerificationStatus), 
    default: ProofVerificationStatus.PENDING,
    index: true,
  },
  verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: { type: Date },
  rejectionReason: { type: String },
  uploadedAt: { type: Date, default: Date.now },
}, { timestamps: true });

PaymentProofSchema.index({ hostelId: 1, verificationStatus: 1 });
PaymentProofSchema.index({ paymentId: 1 });

export const PaymentProofModel = model<IPaymentProof>('PaymentProof', PaymentProofSchema);
```

### Receipt

```typescript
interface IReceipt {
  _id: ObjectId;
  paymentId: ObjectId; // ref Payment, unique
  residentId: ObjectId; // denormalized
  hostelId: ObjectId; // denormalized
  receiptNumber: string; // unique, auto-generated (e.g., "RCP-2026-08-00123")
  pdfUrl?: string; // R2 URL to generated PDF receipt
  issuedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReceiptSchema = new Schema<IReceipt>({
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, unique: true, index: true },
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  receiptNumber: { type: String, required: true, unique: true, index: true },
  pdfUrl: { type: String },
  issuedAt: { type: Date, default: Date.now },
}, { timestamps: true });

ReceiptSchema.index({ hostelId: 1, issuedAt: -1 });

export const ReceiptModel = model<IReceipt>('Receipt', ReceiptSchema);
```

---

## Attendance / Night Safety

### NightStatusLog

```typescript
interface INightStatusLog {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident
  hostelId: ObjectId; // denormalized
  date: Date; // date only, no time (e.g., 2026-08-15 00:00:00)
  status: NightStatusValue;
  source: 'manual' | 'app' | 'auto'; // how it was set
  overriddenBy?: ObjectId; // ref User (warden who manually overrode)
  overrideReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NightStatusLogSchema = new Schema<INightStatusLog>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  date: { type: Date, required: true },
  status: { 
    type: String, 
    enum: Object.values(NightStatusValue), 
    required: true 
  },
  source: { 
    type: String, 
    enum: ['manual', 'app', 'auto'], 
    required: true 
  },
  overriddenBy: { type: Schema.Types.ObjectId, ref: 'User' },
  overrideReason: { type: String },
}, { timestamps: true });

// Unique constraint: one status per resident per date
NightStatusLogSchema.index({ residentId: 1, date: 1 }, { unique: true });
NightStatusLogSchema.index({ hostelId: 1, date: 1 });
NightStatusLogSchema.index({ hostelId: 1, status: 1, date: 1 });

export const NightStatusLogModel = model<INightStatusLog>('NightStatusLog', NightStatusLogSchema);
```

---

## Food

### FoodMenu

```typescript
interface IFoodMenu {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel - MANDATORY for tenant isolation
  date: Date; // specific date (e.g., 2026-08-15)
  mealType: 'breakfast' | 'lunch' | 'snacks' | 'dinner';
  description: string; // "Dal Bhat, Chicken Curry, Achar"
  isVeg: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const FoodMenuSchema = new Schema<IFoodMenu>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  date: { type: Date, required: true, index: true },
  mealType: { 
    type: String, 
    enum: ['breakfast', 'lunch', 'snacks', 'dinner'], 
    required: true 
  },
  description: { type: String, required: true },
  isVeg: { type: Boolean, default: true },
}, { timestamps: true });

// One menu per meal per day per hostel
FoodMenuSchema.index({ hostelId: 1, date: 1, mealType: 1 }, { unique: true });

export const FoodMenuModel = model<IFoodMenu>('FoodMenu', FoodMenuSchema);
```

### FoodPhoto

```typescript
interface IFoodPhoto {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel
  date: Date;
  mealType: 'breakfast' | 'lunch' | 'snacks' | 'dinner';
  photoUrl: string; // R2 URL
  uploadedBy: ObjectId; // ref User (hostel admin/warden)
  createdAt: Date;
  updatedAt: Date;
}

const FoodPhotoSchema = new Schema<IFoodPhoto>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  date: { type: Date, required: true, index: true },
  mealType: { 
    type: String, 
    enum: ['breakfast', 'lunch', 'snacks', 'dinner'], 
    required: true 
  },
  photoUrl: { type: String, required: true },
  uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

FoodPhotoSchema.index({ hostelId: 1, date: 1, mealType: 1 });

export const FoodPhotoModel = model<IFoodPhoto>('FoodPhoto', FoodPhotoSchema);
```

---

## Notices, Complaints

### Notice

```typescript
interface INotice {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel - MANDATORY for tenant isolation
  title: string;
  body: string;
  category: NoticeCategory;
  isUrgent: boolean;
  targetAudience: 'all' | 'residents' | 'guardians'; // who should see/receive this
  createdBy: ObjectId; // ref User (hostel admin/warden)
  createdAt: Date;
  updatedAt: Date;
}

const NoticeSchema = new Schema<INotice>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  title: { type: String, required: true, trim: true },
  body: { type: String, required: true },
  category: { 
    type: String, 
    enum: Object.values(NoticeCategory), 
    default: NoticeCategory.GENERAL 
  },
  isUrgent: { type: Boolean, default: false, index: true },
  targetAudience: { 
    type: String, 
    enum: ['all', 'residents', 'guardians'], 
    default: 'all' 
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

NoticeSchema.index({ hostelId: 1, createdAt: -1 });
NoticeSchema.index({ hostelId: 1, isUrgent: 1, createdAt: -1 });

export const NoticeModel = model<INotice>('Notice', NoticeSchema);
```

### Complaint

```typescript
interface IComplaint {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident
  hostelId: ObjectId; // denormalized
  category: ComplaintCategory;
  title: string;
  description: string;
  photoUrl?: string; // R2 URL
  isAnonymous: boolean;
  status: ComplaintStatus;
  slaDeadline?: Date; // auto-calculated based on PlatformConfig
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ComplaintSchema = new Schema<IComplaint>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  category: { 
    type: String, 
    enum: Object.values(ComplaintCategory), 
    required: true 
  },
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  photoUrl: { type: String },
  isAnonymous: { type: Boolean, default: false },
  status: { 
    type: String, 
    enum: Object.values(ComplaintStatus), 
    default: ComplaintStatus.PENDING,
    index: true,
  },
  slaDeadline: { type: Date, index: true },
  resolvedAt: { type: Date },
}, { timestamps: true });

ComplaintSchema.index({ hostelId: 1, status: 1, createdAt: -1 });
ComplaintSchema.index({ residentId: 1, createdAt: -1 });

export const ComplaintModel = model<IComplaint>('Complaint', ComplaintSchema);
```

### ComplaintUpdate

```typescript
interface IComplaintUpdate {
  _id: ObjectId;
  complaintId: ObjectId; // ref Complaint
  authorId: ObjectId; // ref User (admin/warden/resident)
  authorRole: Role; // to display "Admin replied" vs "Resident replied"
  message: string;
  statusChange?: ComplaintStatus; // if this update changed the status
  createdAt: Date;
  updatedAt: Date;
}

const ComplaintUpdateSchema = new Schema<IComplaintUpdate>({
  complaintId: { type: Schema.Types.ObjectId, ref: 'Complaint', required: true, index: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  authorRole: { 
    type: String, 
    enum: Object.values(Role), 
    required: true 
  },
  message: { type: String, required: true },
  statusChange: { type: String, enum: Object.values(ComplaintStatus) },
}, { timestamps: true });

ComplaintUpdateSchema.index({ complaintId: 1, createdAt: 1 });

export const ComplaintUpdateModel = model<IComplaintUpdate>('ComplaintUpdate', ComplaintUpdateSchema);
```

---

## Ratings

### RatingReview

```typescript
interface IRatingReview {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident
  hostelId: ObjectId; // ref Hostel
  overall: number; // 1-5
  food: number; // 1-5
  cleanliness: number; // 1-5
  security: number; // 1-5
  room: number; // 1-5
  location: number; // 1-5
  management: number; // 1-5
  comment?: string;
  isHidden: boolean; // moderated by superadmin
  hiddenReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RatingReviewSchema = new Schema<IRatingReview>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  overall: { type: Number, required: true, min: 1, max: 5 },
  food: { type: Number, required: true, min: 1, max: 5 },
  cleanliness: { type: Number, required: true, min: 1, max: 5 },
  security: { type: Number, required: true, min: 1, max: 5 },
  room: { type: Number, required: true, min: 1, max: 5 },
  location: { type: Number, required: true, min: 1, max: 5 },
  management: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String },
  isHidden: { type: Boolean, default: false, index: true },
  hiddenReason: { type: String },
}, { timestamps: true });

// One review per resident per hostel
RatingReviewSchema.index({ residentId: 1, hostelId: 1 }, { unique: true });
RatingReviewSchema.index({ hostelId: 1, isHidden: 1, createdAt: -1 });

export const RatingReviewModel = model<IRatingReview>('RatingReview', RatingReviewSchema);
```

---

## Move-in / Move-out

### MoveInChecklist

```typescript
interface IMoveInChecklistItem {
  item: string; // 'ID copy collected', 'Room photos taken', 'Key issued', etc.
  checked: boolean;
  checkedAt?: Date;
  checkedBy?: ObjectId; // ref User
}

interface IMoveInChecklist {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident, unique
  hostelId: ObjectId; // denormalized
  items: IMoveInChecklistItem[];
  rulesAcceptedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MoveInChecklistSchema = new Schema<IMoveInChecklist>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, unique: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  items: [{
    item: { type: String, required: true },
    checked: { type: Boolean, default: false },
    checkedAt: { type: Date },
    checkedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  }],
  rulesAcceptedAt: { type: Date },
}, { timestamps: true });

export const MoveInChecklistModel = model<IMoveInChecklist>('MoveInChecklist', MoveInChecklistSchema);
```

### MoveOutChecklist

```typescript
interface IMoveOutChecklistItem {
  item: string;
  checked: boolean;
  checkedAt?: Date;
  checkedBy?: ObjectId; // ref User
}

interface IMoveOutChecklist {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident, unique
  hostelId: ObjectId; // denormalized
  items: IMoveOutChecklistItem[];
  pendingFeeChecked: boolean;
  damageNotes?: string;
  itemsReturned: boolean;
  depositRefund?: number;
  exitDate?: Date;
  finalReceiptUrl?: string; // R2 URL
  createdAt: Date;
  updatedAt: Date;
}

const MoveOutChecklistSchema = new Schema<IMoveOutChecklist>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, unique: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  items: [{
    item: { type: String, required: true },
    checked: { type: Boolean, default: false },
    checkedAt: { type: Date },
    checkedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  }],
  pendingFeeChecked: { type: Boolean, default: false },
  damageNotes: { type: String },
  itemsReturned: { type: Boolean, default: false },
  depositRefund: { type: Number },
  exitDate: { type: Date },
  finalReceiptUrl: { type: String },
}, { timestamps: true });

export const MoveOutChecklistModel = model<IMoveOutChecklist>('MoveOutChecklist', MoveOutChecklistSchema);
```

---

## Service Providers & Maintenance

### ServiceProvider

```typescript
interface IServiceProvider {
  _id: ObjectId;
  name: string;
  phone: string;
  category: ServiceCategory;
  area: string; // city/locality
  availability: string; // 'Weekdays', '24/7', 'On call', etc.
  description?: string;
  photoUrl?: string; // R2 URL
  documentUrl?: string; // R2 URL (ID proof)
  status: ProviderStatus;
  reviewedBy?: ObjectId; // ref User (superadmin/moderator)
  reviewedAt?: Date;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceProviderSchema = new Schema<IServiceProvider>({
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, index: true },
  category: { 
    type: String, 
    enum: Object.values(ServiceCategory), 
    required: true,
    index: true,
  },
  area: { type: String, required: true, index: true },
  availability: { type: String },
  description: { type: String },
  photoUrl: { type: String },
  documentUrl: { type: String },
  status: { 
    type: String, 
    enum: Object.values(ProviderStatus), 
    default: ProviderStatus.PENDING,
    index: true,
  },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
  rejectionReason: { type: String },
}, { timestamps: true });

ServiceProviderSchema.index({ category: 1, area: 1, status: 1 });

export const ServiceProviderModel = model<IServiceProvider>('ServiceProvider', ServiceProviderSchema);
```

### MaintenanceRequest

```typescript
interface IMaintenanceRequest {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel - MANDATORY for tenant isolation
  roomId?: ObjectId; // ref Room, nullable
  bedId?: ObjectId; // ref Bed, nullable
  providerId?: ObjectId; // ref ServiceProvider, set when contacted
  category: ServiceCategory;
  description: string;
  urgency: 'low' | 'medium' | 'high';
  status: MaintenanceStatus;
  costNote?: string; // informal tracking, not binding
  createdBy: ObjectId; // ref User (hostel admin/warden)
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MaintenanceRequestSchema = new Schema<IMaintenanceRequest>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  roomId: { type: Schema.Types.ObjectId, ref: 'Room' },
  bedId: { type: Schema.Types.ObjectId, ref: 'Bed' },
  providerId: { type: Schema.Types.ObjectId, ref: 'ServiceProvider' },
  category: { 
    type: String, 
    enum: Object.values(ServiceCategory), 
    required: true 
  },
  description: { type: String, required: true },
  urgency: { 
    type: String, 
    enum: ['low', 'medium', 'high'], 
    default: 'medium' 
  },
  status: { 
    type: String, 
    enum: Object.values(MaintenanceStatus), 
    default: MaintenanceStatus.PENDING,
    index: true,
  },
  costNote: { type: String },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  completedAt: { type: Date },
}, { timestamps: true });

MaintenanceRequestSchema.index({ hostelId: 1, status: 1, createdAt: -1 });

export const MaintenanceRequestModel = model<IMaintenanceRequest>('MaintenanceRequest', MaintenanceRequestSchema);
```

---

## Inquiries, Referral, Notifications, Subscriptions

### Inquiry

```typescript
interface IInquiry {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel
  name: string;
  phone: string;
  email?: string;
  message?: string;
  status: InquiryStatus;
  followedUpAt?: Date;
  convertedToResidentId?: ObjectId; // ref Resident, if converted
  createdAt: Date;
  updatedAt: Date;
}

const InquirySchema = new Schema<IInquiry>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true },
  email: { type: String, trim: true, lowercase: true },
  message: { type: String },
  status: { 
    type: String, 
    enum: Object.values(InquiryStatus), 
    default: InquiryStatus.NEW,
    index: true,
  },
  followedUpAt: { type: Date },
  convertedToResidentId: { type: Schema.Types.ObjectId, ref: 'Resident' },
}, { timestamps: true });

InquirySchema.index({ hostelId: 1, status: 1, createdAt: -1 });

export const InquiryModel = model<IInquiry>('Inquiry', InquirySchema);
```

### HostelPageView

One row per visit to a hostel's **public** detail page (`/hostels/{slug}`). Two
consumers, which is why the raw events are kept rather than only a counter:

1. The hostel admin dashboard — "how many people looked at my listing", plus
   unique visitors and a 30-day figure.
2. The resident-identity prompt — a visitor who has viewed hostels 3+ times is
   clearly room-hunting, which is when we offer the fill-once profile
   (see API.md §18.3).

Writes are **de-duplicated per visitor per hostel within 30 minutes**, so a page
refresh or a back-navigation does not inflate the count.

```typescript
interface IHostelPageView {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel
  userId: ObjectId | null; // ref User; null for signed-out visitors
  // Opaque per-browser id from the httpOnly `hh_visitor` cookie.
  // Not personal data — it identifies a browser, not a person.
  visitorKey: string;
  referrer?: string; // truncated to 300 chars
  userAgent?: string; // SHA-256 prefix, never the raw string
  createdAt: Date; // no updatedAt — these rows are immutable
}

const HostelPageViewSchema = new Schema<IHostelPageView>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  visitorKey: { type: String, required: true, index: true },
  referrer: { type: String, trim: true },
  userAgent: { type: String, trim: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

HostelPageViewSchema.index({ hostelId: 1, createdAt: -1 });
HostelPageViewSchema.index({ hostelId: 1, visitorKey: 1, createdAt: -1 }); // dedupe window
HostelPageViewSchema.index({ userId: 1, createdAt: -1 });
HostelPageViewSchema.index({ visitorKey: 1, createdAt: -1 }); // prompt threshold

export const HostelPageViewModel =
  model<IHostelPageView>('HostelPageView', HostelPageViewSchema);
```

`Hostel.publicViewCount` is the denormalised running total, incremented in the
same request. The admin dashboard reads that single number instead of
aggregating this collection; the event rows stay authoritative for the
unique-visitor and recent-traffic breakdowns.

**Growth note:** this collection is append-only and unbounded. The 30-minute
dedupe keeps it proportional to real sessions rather than page loads, but a TTL
or periodic roll-up is worth adding before the platform carries serious traffic.

---

### Referral

```typescript
interface IReferral {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident, unique
  code: string; // unique, 6-8 char alphanumeric
  refereeName?: string;
  refereePhone?: string;
  refereeResidentId?: ObjectId; // ref Resident, set when referee joins
  converted: boolean;
  rewardApplied: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralSchema = new Schema<IReferral>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, unique: true, index: true },
  code: { type: String, required: true, unique: true, index: true },
  refereeName: { type: String },
  refereePhone: { type: String },
  refereeResidentId: { type: Schema.Types.ObjectId, ref: 'Resident' },
  converted: { type: Boolean, default: false, index: true },
  rewardApplied: { type: Boolean, default: false },
}, { timestamps: true });

export const ReferralModel = model<IReferral>('Referral', ReferralSchema);
```

### Notification

```typescript
interface INotification {
  _id: ObjectId;
  userId: ObjectId; // ref User
  type: string; // 'payment_due', 'proof_verified', 'new_notice', 'complaint_update', 'sos', etc.
  title: string;
  body: string;
  data?: Record<string, any>; // additional payload (e.g., { paymentId, complaintId })
  isRead: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type: { type: String, required: true, index: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  data: { type: Schema.Types.Mixed },
  isRead: { type: Boolean, default: false, index: true },
  readAt: { type: Date },
}, { timestamps: true });

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export const NotificationModel = model<INotification>('Notification', NotificationSchema);
```

### Subscription

```typescript
interface ISubscription {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel
  plan: string; // 'free', 'basic', 'premium'
  amount: number;
  status: 'active' | 'expired' | 'pending';
  periodStart: Date;
  periodEnd: Date;
  paidAt?: Date;
  proofUrl?: string; // R2 URL, manual payment proof
  verifiedBy?: ObjectId; // ref User (superadmin)
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  plan: { type: String, required: true },
  amount: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['active', 'expired', 'pending'], 
    default: 'pending',
    index: true,
  },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true, index: true },
  paidAt: { type: Date },
  proofUrl: { type: String },
  verifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  verifiedAt: { type: Date },
}, { timestamps: true });

SubscriptionSchema.index({ hostelId: 1, periodEnd: 1 });

export const SubscriptionModel = model<ISubscription>('Subscription', SubscriptionSchema);
```

---

## Platform Config & Audit

### PlatformConfig

Singleton document (_id = 'default').

```typescript
interface IPlatformConfig {
  _id: 'default';
  paymentReminderDaysBefore: number;
  complaintSlaHours: number;
  referralRewardPoints: number;
  features: {
    mobileAppEnabled: boolean;
    maintenanceRequestsEnabled: boolean;
    ratingsEnabled: boolean;
    guardianDashboardEnabled: boolean;
  };
  emailSettings: {
    sendPaymentReminders: boolean;
    sendNoticeEmails: boolean;
    sendComplaintUpdates: boolean;
  };
  pricing: {
    subscriptionPlans: Array<{
      slug: string;
      name: string;
      priceMonthly: number;
      maxResidents: number;
      features: string[];
    }>;
  };
  updatedAt: Date;
  updatedBy: ObjectId; // ref User
}

const PlatformConfigSchema = new Schema<IPlatformConfig>({
  _id: { type: String, default: 'default' },
  paymentReminderDaysBefore: { type: Number, default: 3 },
  complaintSlaHours: { type: Number, default: 24 },
  referralRewardPoints: { type: Number, default: 100 },
  features: {
    type: {
      mobileAppEnabled: { type: Boolean, default: false },
      maintenanceRequestsEnabled: { type: Boolean, default: true },
      ratingsEnabled: { type: Boolean, default: true },
      guardianDashboardEnabled: { type: Boolean, default: true },
    },
    default: {},
  },
  emailSettings: {
    type: {
      sendPaymentReminders: { type: Boolean, default: true },
      sendNoticeEmails: { type: Boolean, default: true },
      sendComplaintUpdates: { type: Boolean, default: true },
    },
    default: {},
  },
  pricing: {
    type: {
      subscriptionPlans: [{
        slug: String,
        name: String,
        priceMonthly: Number,
        maxResidents: Number,
        features: [String],
      }],
    },
    default: {},
  },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
});

export const PlatformConfigModel = model<IPlatformConfig>('PlatformConfig', PlatformConfigSchema);
```

### AuditLog

```typescript
interface IAuditLog {
  _id: ObjectId;
  actorId?: ObjectId; // ref User, nullable for system actions
  action: string; // 'role_upgrade', 'hostel_approved', 'payment_verified', etc.
  entityType: string; // 'User', 'Hostel', 'Payment', etc.
  entityId: string; // stringified ObjectId of the affected entity
  metadata?: Record<string, any>; // before/after values, reason, etc.
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: String, required: true, index: true },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, index: true },
});

AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });

export const AuditLogModel = model<IAuditLog>('AuditLog', AuditLogSchema);
```

---

## Indexing Strategy Summary

- Every hostel-scoped collection is indexed on `hostelId` — this is what makes tenant-scoped queries fast
- `User.email` and `User.googleId` are unique — enables the account-upgrade logic in ARCHITECTURE.md §3.2
- `Resident.bedId` is unique (sparse) — enforces "a bed can only have one active resident" at the database level
- `RatingReview` has a unique compound index on `(residentId, hostelId)` — enforces "one review per resident per hostel"
- All timestamp-based queries (notices, complaints, payments) have compound indexes including `createdAt` or `dueDate` for efficient sorting
- `User.userResidentId` is unique (sparse) — it is the single lookup key for a portable resident profile, and sparse because most accounts never create one
- `UserResidentProfile` is indexed **only** on `userId`; no personal field is indexed, because every one of them lives inside the encrypted blob
- `HostelPageView` carries `(hostelId, visitorKey, createdAt)` for the 30-minute dedupe check and `(visitorKey, createdAt)` for the profile-prompt threshold — both are per-request reads on the public detail page, so they must not table-scan

---

## Notifications & Push Messaging

### Notification

```typescript
interface INotification {
  _id: ObjectId;
  hostelId?: ObjectId; // ref Hostel - null for platform-wide notifications
  priority: NotificationPriority;
  category: NotificationCategory;
  title: string;
  body: string;
  targetAudience: 'all_residents' | 'specific_residents' | 'all_hostels' | 'specific_hostel';
  targetResidentIds?: ObjectId[]; // ref Resident[] - for specific targeting
  targetHostelIds?: ObjectId[]; // ref Hostel[] - for multi-hostel targeting
  createdBy: ObjectId; // ref User (admin/warden/cook/superadmin)
  scheduledFor?: Date; // for scheduled notifications
  sentAt?: Date;
  deliveryStats: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', index: true },
  priority: { 
    type: String, 
    enum: Object.values(NotificationPriority), 
    default: NotificationPriority.NORMAL 
  },
  category: { 
    type: String, 
    enum: Object.values(NotificationCategory), 
    required: true,
    index: true,
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  targetAudience: { 
    type: String, 
    enum: ['all_residents', 'specific_residents', 'all_hostels', 'specific_hostel'], 
    required: true 
  },
  targetResidentIds: [{ type: Schema.Types.ObjectId, ref: 'Resident' }],
  targetHostelIds: [{ type: Schema.Types.ObjectId, ref: 'Hostel' }],
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  scheduledFor: { type: Date },
  sentAt: { type: Date },
  deliveryStats: {
    sent: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
}, { timestamps: true });

NotificationSchema.index({ hostelId: 1, createdAt: -1 });
NotificationSchema.index({ category: 1, sentAt: -1 });
NotificationSchema.index({ scheduledFor: 1, sentAt: 1 });

export const NotificationModel = model<INotification>('Notification', NotificationSchema);
```

### NotificationReceipt

Tracks individual notification delivery per resident.

```typescript
interface INotificationReceipt {
  _id: ObjectId;
  notificationId: ObjectId; // ref Notification
  residentId: ObjectId; // ref Resident
  userId: ObjectId; // ref User (denormalized from Resident)
  deliveredAt?: Date;
  readAt?: Date;
  dismissed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationReceiptSchema = new Schema<INotificationReceipt>({
  notificationId: { type: Schema.Types.ObjectId, ref: 'Notification', required: true, index: true },
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  deliveredAt: { type: Date },
  readAt: { type: Date },
  dismissed: { type: Boolean, default: false },
}, { timestamps: true });

NotificationReceiptSchema.index({ userId: 1, readAt: 1 });
NotificationReceiptSchema.index({ notificationId: 1, residentId: 1 }, { unique: true });

export const NotificationReceiptModel = model<INotificationReceipt>('NotificationReceipt', NotificationReceiptSchema);
```

### FoodReadyLog

Tracks when cook presses "Food Ready" button.

```typescript
interface IFoodReadyLog {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel
  date: Date;
  mealType: 'breakfast' | 'lunch' | 'snacks' | 'dinner';
  readyAt: Date; // actual time when cook pressed button
  scheduledTime?: Date; // planned time from food menu (optional)
  delayMinutes?: number; // calculated: readyAt - scheduledTime
  cookedBy: ObjectId; // ref User (cook role)
  cookDeviceFingerprint?: string; // to identify which cook if multiple share credentials
  notificationId?: ObjectId; // ref Notification - the notification that was sent
  customMessage?: string; // optional message from cook
  foodMenuId?: ObjectId; // ref FoodMenu - if linked to today's menu
  createdAt: Date;
  updatedAt: Date;
}

const FoodReadyLogSchema = new Schema<IFoodReadyLog>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  date: { type: Date, required: true, index: true },
  mealType: { 
    type: String, 
    enum: ['breakfast', 'lunch', 'snacks', 'dinner'], 
    required: true 
  },
  readyAt: { type: Date, required: true, default: Date.now },
  scheduledTime: { type: Date },
  delayMinutes: { type: Number },
  cookedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  cookDeviceFingerprint: { type: String },
  notificationId: { type: Schema.Types.ObjectId, ref: 'Notification' },
  customMessage: { type: String },
  foodMenuId: { type: Schema.Types.ObjectId, ref: 'FoodMenu' },
}, { timestamps: true });

FoodReadyLogSchema.index({ hostelId: 1, date: 1, mealType: 1 });
FoodReadyLogSchema.index({ hostelId: 1, readyAt: -1 });

export const FoodReadyLogModel = model<IFoodReadyLog>('FoodReadyLog', FoodReadyLogSchema);
```

---

## Location Tracking & Auto-Attendance

### AttendanceLog

Tracks resident location zone at configured check times (morning, evening, night).

```typescript
interface IAttendanceLog {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident
  hostelId: ObjectId; // ref Hostel (denormalized)
  userId: ObjectId; // ref User (denormalized)
  checkTime: Date; // specific datetime of check (e.g., 2026-08-15 08:00:00)
  checkType: 'morning' | 'evening' | 'night' | 'manual'; // which scheduled check
  zone: LocationZone; // INSIDE, NEARBY, OUTSIDE, UNKNOWN
  distance?: number; // meters from hostel (null if UNKNOWN)
  // We DO NOT store exact GPS coordinates for privacy
  source: 'auto' | 'manual_override';
  overriddenBy?: ObjectId; // ref User (admin/warden who manually corrected)
  overrideReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceLogSchema = new Schema<IAttendanceLog>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  checkTime: { type: Date, required: true, index: true },
  checkType: { 
    type: String, 
    enum: ['morning', 'evening', 'night', 'manual'], 
    required: true 
  },
  zone: { 
    type: String, 
    enum: Object.values(LocationZone), 
    required: true,
    index: true,
  },
  distance: { type: Number },
  source: { 
    type: String, 
    enum: ['auto', 'manual_override'], 
    default: 'auto' 
  },
  overriddenBy: { type: Schema.Types.ObjectId, ref: 'User' },
  overrideReason: { type: String },
}, { timestamps: true });

// One log per resident per check time
AttendanceLogSchema.index({ residentId: 1, checkTime: 1 }, { unique: true });
AttendanceLogSchema.index({ hostelId: 1, checkTime: 1, zone: 1 });
AttendanceLogSchema.index({ hostelId: 1, checkType: 1, createdAt: -1 });

export const AttendanceLogModel = model<IAttendanceLog>('AttendanceLog', AttendanceLogSchema);
```

### AttendanceAlert

Tracks alerts triggered when resident is absent for X consecutive days.

```typescript
interface IAttendanceAlert {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident
  hostelId: ObjectId; // ref Hostel
  consecutiveDaysAbsent: number;
  alertTriggeredAt: Date;
  alertSentTo: ObjectId[]; // ref User[] - admins/wardens who were notified
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: ObjectId; // ref User
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AttendanceAlertSchema = new Schema<IAttendanceAlert>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  consecutiveDaysAbsent: { type: Number, required: true },
  alertTriggeredAt: { type: Date, required: true, default: Date.now },
  alertSentTo: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  resolved: { type: Boolean, default: false, index: true },
  resolvedAt: { type: Date },
  resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  notes: { type: String },
}, { timestamps: true });

AttendanceAlertSchema.index({ hostelId: 1, resolved: 1, createdAt: -1 });
AttendanceAlertSchema.index({ residentId: 1, resolved: 1 });

export const AttendanceAlertModel = model<IAttendanceAlert>('AttendanceAlert', AttendanceAlertSchema);
```

---

## Community Feature

### CommunityPost

Hostel-specific or platform-wide community feed (like Facebook wall).

```typescript
interface ICommunityPost {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel - the hostel this post belongs to
  authorId: ObjectId; // ref Resident
  authorName?: string; // null if anonymous
  isAnonymous: boolean;
  visibility: CommunityPostVisibility; // PUBLIC or HOSTEL_ONLY
  content: string; // text content
  mediaUrls: string[]; // photos, videos, audio files (R2 URLs)
  reactions: {
    like: number;
    love: number;
    care: number;
    haha: number;
    sad: number;
    angry: number;
  };
  commentCount: number; // denormalized for performance
  reported: boolean;
  reportedBy?: ObjectId[]; // ref Resident[]
  reportReason?: string;
  hidden: boolean; // admin can hide inappropriate posts
  hiddenBy?: ObjectId; // ref User (admin/warden)
  hiddenAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CommunityPostSchema = new Schema<ICommunityPost>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  authorName: { type: String },
  isAnonymous: { type: Boolean, default: false },
  visibility: { 
    type: String, 
    enum: Object.values(CommunityPostVisibility), 
    default: CommunityPostVisibility.HOSTEL_ONLY,
    index: true,
  },
  content: { type: String, required: true },
  mediaUrls: [{ type: String }],
  reactions: {
    like: { type: Number, default: 0 },
    love: { type: Number, default: 0 },
    care: { type: Number, default: 0 },
    haha: { type: Number, default: 0 },
    sad: { type: Number, default: 0 },
    angry: { type: Number, default: 0 },
  },
  commentCount: { type: Number, default: 0 },
  reported: { type: Boolean, default: false, index: true },
  reportedBy: [{ type: Schema.Types.ObjectId, ref: 'Resident' }],
  reportReason: { type: String },
  hidden: { type: Boolean, default: false, index: true },
  hiddenBy: { type: Schema.Types.ObjectId, ref: 'User' },
  hiddenAt: { type: Date },
}, { timestamps: true });

CommunityPostSchema.index({ hostelId: 1, visibility: 1, hidden: 1, createdAt: -1 });
CommunityPostSchema.index({ authorId: 1, createdAt: -1 });
CommunityPostSchema.index({ reported: 1, hidden: 1 });

export const CommunityPostModel = model<ICommunityPost>('CommunityPost', CommunityPostSchema);
```

### CommunityComment

```typescript
interface ICommunityComment {
  _id: ObjectId;
  postId: ObjectId; // ref CommunityPost
  authorId: ObjectId; // ref Resident
  authorName?: string; // null if anonymous
  isAnonymous: boolean;
  content: string;
  reactions: {
    like: number;
    love: number;
    haha: number;
  };
  reported: boolean;
  reportedBy?: ObjectId[]; // ref Resident[]
  hidden: boolean;
  hiddenBy?: ObjectId; // ref User (admin)
  createdAt: Date;
  updatedAt: Date;
}

const CommunityCommentSchema = new Schema<ICommunityComment>({
  postId: { type: Schema.Types.ObjectId, ref: 'CommunityPost', required: true, index: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true },
  authorName: { type: String },
  isAnonymous: { type: Boolean, default: false },
  content: { type: String, required: true },
  reactions: {
    like: { type: Number, default: 0 },
    love: { type: Number, default: 0 },
    haha: { type: Number, default: 0 },
  },
  reported: { type: Boolean, default: false },
  reportedBy: [{ type: Schema.Types.ObjectId, ref: 'Resident' }],
  hidden: { type: Boolean, default: false },
  hiddenBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

CommunityCommentSchema.index({ postId: 1, createdAt: -1 });
CommunityCommentSchema.index({ authorId: 1, createdAt: -1 });

export const CommunityCommentModel = model<ICommunityComment>('CommunityComment', CommunityCommentSchema);
```

### CommunityReaction

Tracks who reacted to posts/comments.

```typescript
interface ICommunityReaction {
  _id: ObjectId;
  targetType: 'post' | 'comment';
  targetId: ObjectId; // ref CommunityPost or CommunityComment
  residentId: ObjectId; // ref Resident
  reactionType: 'like' | 'love' | 'care' | 'haha' | 'sad' | 'angry';
  createdAt: Date;
  updatedAt: Date;
}

const CommunityReactionSchema = new Schema<ICommunityReaction>({
  targetType: { type: String, enum: ['post', 'comment'], required: true },
  targetId: { type: Schema.Types.ObjectId, required: true, index: true },
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  reactionType: { 
    type: String, 
    enum: ['like', 'love', 'care', 'haha', 'sad', 'angry'], 
    required: true 
  },
}, { timestamps: true });

// One reaction per resident per target
CommunityReactionSchema.index({ targetType: 1, targetId: 1, residentId: 1 }, { unique: true });

export const CommunityReactionModel = model<ICommunityReaction>('CommunityReaction', CommunityReactionSchema);
```

---

## QuestionCall Integration & Analytics

### QuestionCallClick

Tracks when residents click the QuestionCall integration button.

```typescript
interface IQuestionCallClick {
  _id: ObjectId;
  residentId: ObjectId; // ref Resident
  userId: ObjectId; // ref User (denormalized)
  hostelId: ObjectId; // ref Hostel (denormalized)
  clickedAt: Date;
  deviceType?: string; // 'web', 'android', 'ios'
  converted: boolean; // did they actually sign up on QuestionCall?
  conversionTrackedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const QuestionCallClickSchema = new Schema<IQuestionCallClick>({
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, index: true },
  clickedAt: { type: Date, required: true, default: Date.now, index: true },
  deviceType: { type: String, enum: ['web', 'android', 'ios'] },
  converted: { type: Boolean, default: false, index: true },
  conversionTrackedAt: { type: Date },
}, { timestamps: true });

QuestionCallClickSchema.index({ hostelId: 1, clickedAt: -1 });
QuestionCallClickSchema.index({ userId: 1, clickedAt: -1 });
QuestionCallClickSchema.index({ converted: 1, clickedAt: -1 });

export const QuestionCallClickModel = model<IQuestionCallClick>('QuestionCallClick', QuestionCallClickSchema);
```

---

## Hostel Configuration & Settings

### HostelSettings

Per-hostel configurable settings (location tracking, attendance, etc.).

```typescript
interface IHostelSettings {
  _id: ObjectId;
  hostelId: ObjectId; // ref Hostel, unique
  
  // Location Tracking & Attendance Settings
  locationTrackingEnabled: boolean;
  geofenceRadiusMeters: number; // default: 50-100m (configurable)
  insideZoneRadius: number; // default: 50m
  nearbyZoneRadius: number; // default: 200m
  trackingTimes: {
    morning: string; // HH:mm format, e.g., "08:00"
    evening: string; // e.g., "18:00"
    night: string; // e.g., "22:00"
  };
  attendanceAlertThresholdDays: number; // default: 14
  locationDataRetentionDays: number; // default: 600 (configurable, cannot exceed platform max)
  
  // Cook Portal Settings
  cookPortalEnabled: boolean;
  cookName?: string; // e.g., "Sunshine Hostel Cook"
  cookDeviceFingerprints: string[]; // to track multiple cooks sharing credentials
  
  // Community Feature Settings
  communityFeatureEnabled: boolean;
  communityModerationEnabled: boolean;
  profanityFilterEnabled: boolean;
  
  // Notification Settings
  notificationsEnabled: boolean;
  
  // General Settings
  timezone: string; // e.g., "Asia/Kathmandu"
  
  createdAt: Date;
  updatedAt: Date;
}

const HostelSettingsSchema = new Schema<IHostelSettings>({
  hostelId: { type: Schema.Types.ObjectId, ref: 'Hostel', required: true, unique: true, index: true },
  
  locationTrackingEnabled: { type: Boolean, default: true },
  geofenceRadiusMeters: { type: Number, default: 100 },
  insideZoneRadius: { type: Number, default: 50 },
  nearbyZoneRadius: { type: Number, default: 200 },
  trackingTimes: {
    morning: { type: String, default: '08:00' },
    evening: { type: String, default: '18:00' },
    night: { type: String, default: '22:00' },
  },
  attendanceAlertThresholdDays: { type: Number, default: 14 },
  locationDataRetentionDays: { type: Number, default: 600 },
  
  cookPortalEnabled: { type: Boolean, default: false },
  cookName: { type: String },
  cookDeviceFingerprints: [{ type: String }],
  
  communityFeatureEnabled: { type: Boolean, default: true },
  communityModerationEnabled: { type: Boolean, default: true },
  profanityFilterEnabled: { type: Boolean, default: true },
  
  notificationsEnabled: { type: Boolean, default: true },
  
  timezone: { type: String, default: 'Asia/Kathmandu' },
}, { timestamps: true });

export const HostelSettingsModel = model<IHostelSettings>('HostelSettings', HostelSettingsSchema);
```

### PlatformConfig

Platform-wide configuration set by superadmin (limits, defaults, overrides).

```typescript
interface IPlatformConfig {
  _id: ObjectId;
  key: string; // unique config key, e.g., "location_tracking_max_retention_days"
  value: any; // flexible value type (string, number, boolean, object)
  description: string;
  category: 'location' | 'notifications' | 'community' | 'general' | 'limits';
  editable: boolean; // can hostel admin override this?
  createdAt: Date;
  updatedAt: Date;
}

const PlatformConfigSchema = new Schema<IPlatformConfig>({
  key: { type: String, required: true, unique: true, index: true },
  value: { type: Schema.Types.Mixed, required: true },
  description: { type: String, required: true },
  category: { 
    type: String, 
    enum: ['location', 'notifications', 'community', 'general', 'limits'], 
    required: true,
    index: true,
  },
  editable: { type: Boolean, default: false },
}, { timestamps: true });

export const PlatformConfigModel = model<IPlatformConfig>('PlatformConfig', PlatformConfigSchema);
```

---

## Consent & Privacy

### ConsentLog

Tracks when residents consent to terms, privacy policy, location tracking.

```typescript
interface IConsentLog {
  _id: ObjectId;
  userId: ObjectId; // ref User
  residentId?: ObjectId; // ref Resident (if applicable)
  consentType: 'terms_of_use' | 'privacy_policy' | 'location_tracking';
  consentVersion: string; // e.g., "v1.0", "v2.1"
  consented: boolean;
  consentedAt: Date;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ConsentLogSchema = new Schema<IConsentLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  residentId: { type: Schema.Types.ObjectId, ref: 'Resident' },
  consentType: { 
    type: String, 
    enum: ['terms_of_use', 'privacy_policy', 'location_tracking'], 
    required: true 
  },
  consentVersion: { type: String, required: true },
  consented: { type: Boolean, required: true },
  consentedAt: { type: Date, required: true, default: Date.now },
  ipAddress: { type: String },
  userAgent: { type: String },
}, { timestamps: true });

ConsentLogSchema.index({ userId: 1, consentType: 1, consentedAt: -1 });

export const ConsentLogModel = model<IConsentLog>('ConsentLog', ConsentLogSchema);
```

### AccountDeletionRequest

Tracks requests from users to delete their account (60-day grace period).

```typescript
interface IAccountDeletionRequest {
  _id: ObjectId;
  userId: ObjectId; // ref User, unique (only one active request per user)
  reason: string;
  requestedAt: Date;
  scheduledDeletionAt: Date; // requestedAt + 60 days
  cancelled: boolean;
  cancelledAt?: Date;
  executed: boolean;
  executedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AccountDeletionRequestSchema = new Schema<IAccountDeletionRequest>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  reason: { type: String, required: true },
  requestedAt: { type: Date, required: true, default: Date.now },
  scheduledDeletionAt: { type: Date, required: true },
  cancelled: { type: Boolean, default: false, index: true },
  cancelledAt: { type: Date },
  executed: { type: Boolean, default: false, index: true },
  executedAt: { type: Date },
}, { timestamps: true });

AccountDeletionRequestSchema.index({ scheduledDeletionAt: 1, executed: 1, cancelled: 1 });

export const AccountDeletionRequestModel = model<IAccountDeletionRequest>('AccountDeletionRequest', AccountDeletionRequestSchema);
```

---

## Cook Portal

**Note:** Cook users are tracked via `User` model with `role = COOK`. Cook-specific data (name, device fingerprints) is stored in `HostelSettings.cookName` and `HostelSettings.cookDeviceFingerprints`.

---

## Migrations (Mongoose)

Mongoose doesn't have a formal migration system like Prisma. Use a migrations folder with timestamped scripts:

```
packages/db/migrations/
  001_seed_platform_config.ts
  002_create_indexes.ts
  003_add_nearby_places_field.ts
```

Run migrations manually during deployment or via a migration runner script.

---

_End of DATABASE.md_

