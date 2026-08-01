import nextEnv from "@next/env";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");
const { loadEnvConfig } = nextEnv;

loadEnvConfig(repoRoot);

const DEMO_PASSWORD = process.env.DEMO_SEED_PASSWORD ?? "admin";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required to seed demo data.");
}

if (!DEMO_PASSWORD) {
  throw new Error("DEMO_SEED_PASSWORD is required.");
}

const looseSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const User = mongoose.models.User ?? mongoose.model("User", looseSchema);
const Hostel = mongoose.models.Hostel ?? mongoose.model("Hostel", looseSchema);
const HostelMember =
  mongoose.models.HostelMember ?? mongoose.model("HostelMember", looseSchema);
const Floor = mongoose.models.Floor ?? mongoose.model("Floor", looseSchema);
const Room = mongoose.models.Room ?? mongoose.model("Room", looseSchema);
const Bed = mongoose.models.Bed ?? mongoose.model("Bed", looseSchema);
const Resident = mongoose.models.Resident ?? mongoose.model("Resident", looseSchema);
const Guardian = mongoose.models.Guardian ?? mongoose.model("Guardian", looseSchema);
const EmergencyContact =
  mongoose.models.EmergencyContact ?? mongoose.model("EmergencyContact", looseSchema);
const Inquiry = mongoose.models.Inquiry ?? mongoose.model("Inquiry", looseSchema);
const FoodRoutine =
  mongoose.models.FoodRoutine ?? mongoose.model("FoodRoutine", looseSchema);
const Notice = mongoose.models.Notice ?? mongoose.model("Notice", looseSchema);
const Payment = mongoose.models.Payment ?? mongoose.model("Payment", looseSchema);

const now = new Date();
const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
const moveInDate = new Date("2026-06-01T00:00:00.000Z");
const demoDataLabel = "Seed data: demo/test_data";
const demoDataFields = {
  demoDataLabel,
  isDemoData: true,
};

const hostels = [
  {
    area: "New Baneshwor",
    city: "Kathmandu",
    email: "green-view@hostelhub.local",
    name: "Green View Student Hostel",
    phone: "9800001001",
    rentMax: 18000,
    rentMin: 14000,
    roomNumber: "101",
    slug: "demo-green-view-hostel",
    student: {
      email: "student1@gmail.com",
      firstName: "Aarav",
      lastName: "Shrestha",
      phone: "9800002001",
    },
    type: "CO_LIVING",
  },
  {
    area: "Putalisadak",
    city: "Kathmandu",
    email: "city-light@hostelhub.local",
    name: "City Light Girls Hostel",
    phone: "9800001002",
    rentMax: 16500,
    rentMin: 12500,
    roomNumber: "202",
    slug: "demo-city-light-hostel",
    student: {
      email: "student2@gmail.com",
      firstName: "Nisha",
      lastName: "Rai",
      phone: "9800002002",
    },
    type: "GIRLS",
  },
  {
    area: "Lalitpur",
    city: "Lalitpur",
    email: "himalayan-stay@hostelhub.local",
    name: "Himalayan Stay Boys Hostel",
    phone: "9800001003",
    rentMax: 15000,
    rentMin: 11000,
    roomNumber: "303",
    slug: "demo-himalayan-stay-hostel",
    student: {
      email: "student3@gmail.com",
      firstName: "Sujan",
      lastName: "Tamang",
      phone: "9800002003",
    },
    type: "BOYS",
  },
];

async function upsertUser({
  email,
  hostelIds = [],
  name,
  phone,
  role,
  status = "ACTIVE",
}) {
  return User.findOneAndUpdate(
    { email },
    {
      $set: {
        email,
        emailVerifiedAt: now,
        hostelIds,
        isDeleted: false,
        name,
        passwordHash,
        phone,
        role,
        status,
        ...demoDataFields,
      },
    },
    { returnDocument: "after", setDefaultsOnInsert: true, upsert: true },
  );
}

async function upsertHostelOwner(index) {
  return upsertUser({
    email: `hostelowner${index + 1}@gmail.com`,
    name: `Demo Hostel Owner ${index + 1}`,
    phone: `98000030${index + 1}`,
    role: "HOSTEL_ADMIN",
  });
}

await mongoose.connect(process.env.MONGODB_URI, {
  bufferCommands: false,
});

await Hostel.updateOne(
  { slug: "demo-kathmandu-hostel" },
  {
    $set: {
      status: "DRAFT",
      ...demoDataFields,
      isDeleted: true,
    },
  },
);

const platformOwner = await upsertUser({
  email: "superadmin@gmail.com",
  name: "Super Admin",
  phone: "9800000000",
  role: "SUPERADMIN",
});

const hostelAdmin = await upsertUser({
  email: "hosteladmin1@gmail.com",
  name: "Demo Hostel Admin 1",
  phone: "9800000001",
  role: "HOSTEL_ADMIN",
});

const seededHostels = [];
const seededStudents = [];

for (const [index, hostelInput] of hostels.entries()) {
  const hostelOwner = await upsertHostelOwner(index);
  const hostel = await Hostel.findOneAndUpdate(
    { slug: hostelInput.slug },
    {
      $set: {
        capacitySummary: { totalBeds: 4, totalRooms: 2, vacantBeds: 3 },
        contact: { email: hostelInput.email, phone: hostelInput.phone },
        createdBy: platformOwner._id,
        description: `${hostelInput.name} is seeded mock/test_data for portal walkthroughs.`,
        facilities: ["Wi-Fi", "Laundry", "Study room", "Hot water"],
        food: {
          hasNonVeg: hostelInput.type !== "GIRLS",
          hasVeg: true,
          mealsPerDay: 3,
          notes: "Seeded weekly meal schedule.",
        },
        hostelType: hostelInput.type,
        isDeleted: false,
        location: {
          address: `Demo Marg, ${hostelInput.area}`,
          area: hostelInput.area,
          city: hostelInput.city,
          province: "Bagmati",
        },
        name: hostelInput.name,
        ownerId: hostelOwner._id,
        photos: [
          {
            alt: `${hostelInput.name} demo exterior`,
            url: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80",
          },
        ],
        pricing: {
          admissionFee: 5000,
          currency: "NPR",
          monthlyRentMax: hostelInput.rentMax,
          monthlyRentMin: hostelInput.rentMin,
        },
        roomTypes: ["Shared", "Private"],
        rules: ["Quiet hours after 10 PM", "Visitor entry requires warden approval"],
        slug: hostelInput.slug,
        status: "PUBLISHED",
        updatedBy: platformOwner._id,
        verificationStatus: "VERIFIED",
        ...demoDataFields,
      },
    },
    { returnDocument: "after", setDefaultsOnInsert: true, upsert: true },
  );

  seededHostels.push(hostel);

  await User.updateOne(
    { _id: hostelOwner._id },
    { $set: { hostelIds: [hostel._id], ...demoDataFields } },
  );

  await HostelMember.findOneAndUpdate(
    { hostelId: hostel._id, userId: hostelOwner._id },
    {
      $set: {
        createdBy: platformOwner._id,
        hostelId: hostel._id,
        isDeleted: false,
        role: "HOSTEL_ADMIN",
        status: "ACTIVE",
        updatedBy: platformOwner._id,
        userId: hostelOwner._id,
        ...demoDataFields,
      },
    },
    { upsert: true },
  );

  if (index === 0) {
    await User.updateOne(
      { _id: hostelAdmin._id },
      { $set: { hostelIds: [hostel._id], ...demoDataFields } },
    );
    await HostelMember.findOneAndUpdate(
      { hostelId: hostel._id, userId: hostelAdmin._id },
      {
        $set: {
          createdBy: platformOwner._id,
          hostelId: hostel._id,
          isDeleted: false,
          role: "HOSTEL_ADMIN",
          status: "ACTIVE",
          updatedBy: platformOwner._id,
          userId: hostelAdmin._id,
          ...demoDataFields,
        },
      },
      { upsert: true },
    );
  }

  const floor = await Floor.findOneAndUpdate(
    { hostelId: hostel._id, level: 1 },
    {
      $set: {
        createdBy: hostelAdmin._id,
        description: "Seeded main resident floor",
        hostelId: hostel._id,
        isDeleted: false,
        level: 1,
        name: "First Floor",
        sortOrder: 1,
        status: "ACTIVE",
        updatedBy: hostelAdmin._id,
        ...demoDataFields,
      },
    },
    { returnDocument: "after", setDefaultsOnInsert: true, upsert: true },
  );

  const room = await Room.findOneAndUpdate(
    { hostelId: hostel._id, roomNumber: hostelInput.roomNumber },
    {
      $set: {
        capacity: 2,
        createdBy: hostelAdmin._id,
        facilities: ["Window", "Table", "Cupboard"],
        floorId: floor._id,
        hostelId: hostel._id,
        isDeleted: false,
        repairStatus: "OK",
        roomNumber: hostelInput.roomNumber,
        roomType: "Shared",
        status: "ACTIVE",
        updatedBy: hostelAdmin._id,
        vacancyStatus: "PARTIAL",
        ...demoDataFields,
      },
    },
    { returnDocument: "after", setDefaultsOnInsert: true, upsert: true },
  );

  const bed = await Bed.findOneAndUpdate(
    { bedNumber: `${hostelInput.roomNumber}-A`, hostelId: hostel._id, roomId: room._id },
    {
      $set: {
        bedNumber: `${hostelInput.roomNumber}-A`,
        createdBy: hostelAdmin._id,
        floorId: floor._id,
        hostelId: hostel._id,
        isDeleted: false,
        repairStatus: "OK",
        roomId: room._id,
        status: "OCCUPIED",
        updatedBy: hostelAdmin._id,
        ...demoDataFields,
      },
    },
    { returnDocument: "after", setDefaultsOnInsert: true, upsert: true },
  );

  const availableBed = await Bed.findOneAndUpdate(
    { bedNumber: `${hostelInput.roomNumber}-B`, hostelId: hostel._id, roomId: room._id },
    {
      $set: {
        bedNumber: `${hostelInput.roomNumber}-B`,
        createdBy: hostelAdmin._id,
        floorId: floor._id,
        hostelId: hostel._id,
        isDeleted: false,
        repairStatus: "OK",
        roomId: room._id,
        status: "AVAILABLE",
        updatedBy: hostelAdmin._id,
        ...demoDataFields,
      },
    },
    { returnDocument: "after", setDefaultsOnInsert: true, upsert: true },
  );

  const studentUser = await upsertUser({
    email: hostelInput.student.email,
    hostelIds: [hostel._id],
    name: `${hostelInput.student.firstName} ${hostelInput.student.lastName}`,
    phone: hostelInput.student.phone,
    role: "RESIDENT",
  });

  const resident = await Resident.findOneAndUpdate(
    { hostelId: hostel._id, phone: hostelInput.student.phone },
    {
      $set: {
        bedId: bed._id,
        createdBy: hostelAdmin._id,
        depositAmount: 10000 + index * 1000,
        email: hostelInput.student.email,
        firstName: hostelInput.student.firstName,
        hostelId: hostel._id,
        isDeleted: false,
        lastName: hostelInput.student.lastName,
        moveInDate,
        phone: hostelInput.student.phone,
        roomId: room._id,
        status: "ACTIVE",
        updatedBy: hostelAdmin._id,
        userId: studentUser._id,
        ...demoDataFields,
      },
    },
    { returnDocument: "after", setDefaultsOnInsert: true, upsert: true },
  );

  seededStudents.push(studentUser);

  await Bed.updateOne(
    { _id: bed._id },
    {
      $set: {
        assignedResidentId: resident._id,
        status: "OCCUPIED",
        ...demoDataFields,
      },
    },
  );
  await Bed.updateOne(
    { _id: availableBed._id },
    {
      $set: {
        assignedResidentId: null,
        status: "AVAILABLE",
        ...demoDataFields,
      },
    },
  );

  await Guardian.findOneAndUpdate(
    { phone: `98000040${index + 1}`, residentId: resident._id },
    {
      $set: {
        email: `guardian${index + 1}@gmail.com`,
        firstName: "Demo",
        hostelId: hostel._id,
        isPrimary: true,
        lastName: `Guardian ${index + 1}`,
        phone: `98000040${index + 1}`,
        relation: "Parent",
        residentId: resident._id,
        ...demoDataFields,
      },
    },
    { upsert: true },
  );

  await EmergencyContact.findOneAndUpdate(
    { phone: `98000050${index + 1}`, residentId: resident._id },
    {
      $set: {
        hostelId: hostel._id,
        isPrimary: true,
        name: `Demo Emergency Contact ${index + 1}`,
        phone: `98000050${index + 1}`,
        relation: "Local guardian",
        residentId: resident._id,
        ...demoDataFields,
      },
    },
    { upsert: true },
  );

  await Inquiry.findOneAndUpdate(
    { hostelId: hostel._id, phone: `98000060${index + 1}` },
    {
      $set: {
        areaPreference: hostelInput.area,
        hostelId: hostel._id,
        message: "Seeded inquiry for hostel-admin follow-up.",
        name: `Prospective Student ${index + 1}`,
        phone: `98000060${index + 1}`,
        source: "PUBLIC_WEBSITE",
        status: "NEW",
        ...demoDataFields,
      },
    },
    { upsert: true },
  );

  await Payment.findOneAndUpdate(
    { hostelId: hostel._id, month: "2026-06", residentId: resident._id },
    {
      $set: {
        createdBy: hostelAdmin._id,
        dueAmount: hostelInput.rentMin,
        dueDate: new Date("2026-06-10T00:00:00.000Z"),
        hostelId: hostel._id,
        month: "2026-06",
        paidAmount: 0,
        residentId: resident._id,
        status: "UNPAID",
        updatedBy: hostelAdmin._id,
        ...demoDataFields,
      },
    },
    { upsert: true },
  );

  // One routine per hostel, keyed by day of week — it repeats every week.
  await FoodRoutine.findOneAndUpdate(
    { hostelId: hostel._id },
    {
      $set: {
        hostelId: hostel._id,
        meals: [
          {
            dayOfWeek: "SATURDAY",
            items: ["Dal", "Rice", "Mixed curry", "Achar"],
            mealType: "DINNER",
          },
        ],
        timings: { DINNER: "7:30 PM - 9:00 PM" },
        updatedBy: hostelAdmin._id,
        ...demoDataFields,
      },
    },
    { upsert: true },
  );

  await Notice.findOneAndUpdate(
    { hostelId: hostel._id, title: "Demo Notice" },
    {
      $set: {
        category: "GENERAL",
        content: "This seeded notice confirms the resident notice feed is connected.",
        createdBy: hostelAdmin._id,
        hostelId: hostel._id,
        isUrgent: false,
        publishedAt: now,
        title: "Demo Notice",
        updatedBy: hostelAdmin._id,
        ...demoDataFields,
      },
    },
    { upsert: true },
  );
}

await User.updateOne(
  { _id: platformOwner._id },
  { $set: { hostelIds: [], ...demoDataFields } },
);

await mongoose.disconnect();

console.log("Demo seed ready:");
console.log("  super admin: superadmin@gmail.com / admin");
console.log("  hostel admin: hosteladmin1@gmail.com / admin");
console.log("  student users:");
for (const student of seededStudents) {
  console.log(`    ${student.email} / admin`);
}
console.log("  demo hostels:");
for (const hostel of seededHostels) {
  console.log(`    ${hostel.name} (${hostel.slug})`);
}
