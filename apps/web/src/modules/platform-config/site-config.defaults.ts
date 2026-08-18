import type { SiteConfig } from "./site-config.validation";

/**
 * Shipped defaults. A section that has never been saved falls back to these, so
 * the public site always renders even on a fresh database.
 */
export const DEFAULT_SITE_CONFIG: SiteConfig = {
  announcement: {
    enabled: false,
    link: "",
    linkLabel: "",
    message: "",
    tone: "info",
  },
  /**
   * All blank, deliberately. Blank is not "unset and broken" here — each field
   * resolves to a working fallback (see `emailSchema`), so a fresh database
   * sends correctly branded mail from `info@`, `alert@`, `billing@` and friends
   * without anyone visiting the settings page.
   */
  email: {
    alertMailbox: "",
    billingMailbox: "",
    domain: "",
    infoMailbox: "",
    noreplyMailbox: "",
    replyTo: "",
    securityMailbox: "",
    senderName: "",
    supportMailbox: "",
  },
  facilities: [
    { enabled: true, icon: "wifi", label: "Free WiFi", slug: "wifi" },
    { enabled: true, icon: "utensils", label: "Meals Included", slug: "meals" },
    { enabled: true, icon: "shirt", label: "Laundry", slug: "laundry" },
    { enabled: true, icon: "car", label: "Parking", slug: "parking" },
    { enabled: true, icon: "shield", label: "24/7 Security", slug: "security" },
    { enabled: true, icon: "camera", label: "CCTV", slug: "cctv" },
    { enabled: true, icon: "zap", label: "Power Backup", slug: "power-backup" },
    { enabled: true, icon: "droplet", label: "Hot Water", slug: "hot-water" },
    { enabled: true, icon: "book", label: "Study Room", slug: "study-room" },
    { enabled: true, icon: "dumbbell", label: "Gym", slug: "gym" },
  ],
  features: {
    compare: true,
    inquiries: true,
    publicRegistration: true,
    reviews: true,
    serviceProviderSignup: true,
  },
  hero: {
    headline: "Find a hostel you can actually trust",
    primaryCtaHref: "/hostels",
    primaryCtaLabel: "Browse Hostels",
    searchPlaceholder: "Search by city, area, or hostel name",
    secondaryCtaHref: "/register-hostel",
    secondaryCtaLabel: "List Your Hostel",
    subheadline:
      "Verified hostels across Nepal with real photos, transparent pricing, and honest resident reviews.",
  },
  identity: {
    address: "Kathmandu, Nepal",
    siteName: "HostelHub",
    /**
     * Published in the public footer, so it has to be a domain that exists.
     * The previous default was `support@hostelhub.com.np` — a plausible-looking
     * address nobody owns — which sat unnoticed until it leaked into the email
     * `Reply-To` and bounced. A placeholder that looks real is worse than an
     * obvious one; this is the actual Softmato support address.
     */
    supportEmail: "support@softmato.com",
    supportPhone: "+977-1-5432123",
    tagline: "Find & manage hostels in Nepal",
  },
  legal: {
    privacy: { body: "", updatedAt: "" },
    terms: { body: "", updatedAt: "" },
  },
  /**
   * The cities the platform is open in. Two surfaces read this, and the second
   * one is why the order matters:
   *
   * 1. The public site's search and registration filters (`areas` fills the
   *    area dropdown under each city).
   * 2. The mobile home screen's **Popular Cities** row, which draws one card per
   *    enabled city **in this order** and shows each one's real listing count —
   *    `0` included. So this list is the launch plan, not a report: a city
   *    belongs here as soon as the business is open in it, and its card is what
   *    the first hostel there will have been found through.
   *
   * Edited at Website Config → Locations, which is where it should be changed —
   * these are the shipped defaults for a fresh database, nothing more.
   */
  locations: [
    {
      areas: ["Baneshwor", "Koteshwor", "Kirtipur", "Dillibazar", "Bhaisepati"],
      city: "Kathmandu",
      enabled: true,
    },
    { areas: ["Lalitpur", "Bagdol", "Jhamsikhel"], city: "Lalitpur", enabled: true },
    { areas: ["Suryabinayak", "Thimi"], city: "Bhaktapur", enabled: true },
    { areas: ["Lakeside", "Bagar", "Chipledhunga"], city: "Pokhara", enabled: true },
    { areas: ["Bharatpur", "Narayangarh", "Sauraha"], city: "Chitwan", enabled: true },
    { areas: ["Biratnagar"], city: "Biratnagar", enabled: true },
  ],
  pricing: [
    {
      ctaHref: "/register-hostel",
      ctaLabel: "Start Free",
      description: "For a single small hostel getting online.",
      enabled: true,
      features: [
        "1 hostel listing",
        "Up to 25 residents",
        "Room & bed map",
        "Payment records",
      ],
      highlighted: false,
      name: "Basic",
      period: "per month",
      price: "NPR 5,000",
    },
    {
      ctaHref: "/register-hostel",
      ctaLabel: "Get Started",
      description: "For growing hostels that need full operations.",
      enabled: true,
      features: [
        "1 hostel listing",
        "Unlimited residents",
        "Food & complaint modules",
        "Guardian dashboard",
        "Priority support",
      ],
      highlighted: true,
      name: "Pro",
      period: "per month",
      price: "NPR 8,500",
    },
    {
      ctaHref: "/contact",
      ctaLabel: "Contact Sales",
      description: "For operators running multiple properties.",
      enabled: true,
      features: [
        "Unlimited hostels",
        "Multi-property reporting",
        "Custom onboarding",
        "Dedicated account manager",
      ],
      highlighted: false,
      name: "Enterprise",
      period: "per month",
      price: "NPR 25,000",
    },
  ],
  social: {
    facebook: "",
    instagram: "",
    linkedin: "",
    tiktok: "",
    website: "",
    youtube: "",
  },
  stats: [
    { label: "Verified hostels", suffix: "+", value: "1,248" },
    { label: "Active residents", suffix: "+", value: "18,742" },
    { label: "Cities covered", suffix: "", value: "12" },
    { label: "Average rating", suffix: "/5", value: "4.6" },
  ],
  trustPoints: [
    {
      description:
        "Every listing is checked against ownership papers before it goes live.",
      icon: "shield",
      title: "Verified listings only",
    },
    {
      description:
        "Monthly rent, deposit, and extra charges shown upfront — no surprises.",
      icon: "wallet",
      title: "Transparent pricing",
    },
    {
      description: "Reviews come from activated residents, not anonymous accounts.",
      icon: "star",
      title: "Real resident reviews",
    },
    {
      description: "Guardians get fee and safety visibility without invading privacy.",
      icon: "users",
      title: "Built for families",
    },
  ],
};
