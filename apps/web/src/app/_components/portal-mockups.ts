/**
 * Device mockups of the product, served from `public/mockups/`.
 *
 * Every file is a transparent WebP — no backdrop baked in — so it sits on any
 * section ground in either theme. A replacement must be exported the same way:
 * a mockup with its own black or checkerboard backdrop reads as a slab on the
 * page. `width`/`height` are the files' intrinsic size, for `next/image`.
 */
export type Mockup = { alt: string; height: number; src: string; width: number };

function mockup(name: string, alt: string, width = 1536, height = 1024): Mockup {
  return { alt, height, src: `/mockups/${name}.webp`, width };
}

export const MOCKUPS = {
  appCommunity: mockup(
    "app-public-community-hostelviewpage",
    "The app's community feed beside a hostel's public page",
  ),
  appHome: mockup(
    "app-public-facing",
    "The app's home screen with top picks, popular cities and nearby hostels",
    1230,
    1278,
  ),
  appMap: mockup("app-public-map-screen", "Hostels on the map with walking directions"),
  appMapAndroid: mockup(
    "app-public-map-android-screen",
    "The hostel map on an Android phone",
  ),
  guardianPortal: mockup("guardian-portal", "The guardian portal on a laptop and a phone"),
  residentFees: mockup("resident-portal-feepayment", "A resident's fees and payments"),
  residentPortal: mockup("resident-portal", "The resident portal dashboard"),
  residentProfile: mockup("resident-portal-profile", "A resident's profile and ID card"),
  residentRegister: mockup(
    "resident-register-whole-process",
    "Registering a resident, step by step, in the app",
  ),
  residentVerify: mockup(
    "resident-register-process-step-2",
    "Confirming a resident's identity after scanning their card",
  ),
  wardenDashboard: mockup("warden-dashboard", "The hostel dashboard on a laptop and a phone"),
  wardenFinance: mockup("warden-dashboard-finance", "The fee schedule and statement reconcile"),
  wardenPaymentSetup: mockup(
    "warden-paymentsetup-statement",
    "Payment setup with eSewa, Khalti and bank accounts",
  ),
  wardenRooms: mockup("warden-room-management", "Rooms and bed rates by sharing type"),
  wardenTransactions: mockup("warden-dashboard-transaction", "The hostel's transactions list"),
} as const;
