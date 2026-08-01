export type AuthUser = {
  email: string | null;
  id: string;
  name: string;
  phone: string | null;
  role: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

export type PublicHostel = {
  capacitySummary?: {
    totalBeds?: number;
    totalRooms?: number;
    vacantBeds?: number;
  };
  description?: string;
  facilities: string[];
  food?: {
    hasNonVeg?: boolean;
    hasVeg?: boolean;
    mealsPerDay?: number;
    notes?: string;
  };
  hostelType: "BOYS" | "GIRLS" | "CO_LIVING";
  id: string;
  location: {
    address?: string;
    area: string;
    city?: string;
  };
  name: string;
  photos: Array<{
    alt?: string;
    url?: string;
  }>;
  pricing?: {
    currency?: string;
    monthlyRentMax?: number;
    monthlyRentMin?: number;
  };
  roomTypes: string[];
  rules?: string[];
  slug: string;
  verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
};

export type ResidentSummary = {
  depositAmount: number;
  email?: string;
  firstName: string;
  fullName?: string;
  id: string;
  lastName: string;
  phone: string;
  status: string;
};

export type ResidentDashboard = {
  feeStatus: {
    dueAmount: number;
    pendingProofs: number;
    unpaidCount: number;
  };
  foodMenu: ResidentFoodMenu[];
  hostel: {
    name: string;
    location?: {
      area?: string;
      city?: string;
    };
  } | null;
  nightStatus: {
    status: string;
  };
  notices: ResidentNotice[];
  resident: ResidentSummary;
  roomBed: {
    bed: {
      bedNumber: string;
      status: string;
    } | null;
    room: {
      roomNumber: string;
      roomType: string;
    } | null;
  };
};

export type ResidentPayment = {
  dueAmount: number;
  dueDate: string;
  id: string;
  month: string;
  paidAmount: number;
  status: string;
};

export type ResidentPaymentProof = {
  id: string;
  paymentId: string;
  proofImageAssetId: string;
  status: string;
  transactionCode?: string;
};

export type ResidentFoodMenu = {
  dayOfWeek: string;
  items: string[];
  mealType: string;
  note: string;
  timing: string;
};

export type ResidentFoodRoutine = {
  meals: ResidentFoodMenu[];
  monthEndSpecial: { items: string[]; note: string } | null;
};

export type ResidentFoodPhoto = {
  caption?: string;
  date: string;
  id: string;
  mealType: string;
  photoAssetId: string;
};

export type ResidentNotice = {
  category: string;
  content: string;
  id: string;
  isRead?: boolean;
  isUrgent: boolean;
  title: string;
};

export type ResidentComplaint = {
  adminResponse?: string;
  category: string;
  confirmedAt?: string;
  description: string;
  id: string;
  isAnonymous: boolean;
  status: string;
  title: string;
};

export type ResidentNightStatus = {
  checkedAt: string | null;
  status: string;
};

export type NotificationItem = {
  body: string;
  id: string;
  isRead: boolean;
  title: string;
};

export type ResidentReferral = {
  id: string;
  name: string;
  phone: string;
  status: string;
};

export type ResidentReferralCode = {
  code: string;
  joinedCount: number;
  link: string;
  rewardCount: number;
};

type ApiSuccess<T> = {
  data: T;
  message: string;
  success: true;
};

type ApiFailure = {
  errorCode: string;
  message: string;
  success: false;
};

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:3000";

async function apiRequest<T>(
  path: string,
  options: {
    accessToken?: string;
    body?: unknown;
    method?: "GET" | "PATCH" | "POST";
  } = {},
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      "Content-Type": "application/json",
      "x-hostelhub-client": "mobile",
      ...(options.accessToken
        ? { Authorization: `Bearer ${options.accessToken}` }
        : {}),
    },
    method: options.method ?? "GET",
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiSuccess<T>
    | ApiFailure
    | null;

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message ?? "Request failed.");
  }

  return payload.data;
}

export function login(identifier: string, password: string) {
  return apiRequest<AuthSession>("/api/v1/auth/login", {
    body: { identifier, password },
    method: "POST",
  });
}

export function requestOtp(identifier: string) {
  return apiRequest<{
    challengeId: string;
    devCode?: string;
    expiresAt: string;
  }>("/api/v1/auth/otp/request", {
    body: { channel: "email", identifier, purpose: "registration" },
    method: "POST",
  });
}

export function verifyOtp(challengeId: string, code: string) {
  return apiRequest<{
    challengeId: string;
    verifiedAt: string;
  }>("/api/v1/auth/otp/verify", {
    body: { challengeId, code },
    method: "POST",
  });
}

export function register(input: {
  email: string;
  name: string;
  otpChallengeId: string;
  password: string;
}) {
  return apiRequest<AuthSession>("/api/v1/auth/register", {
    body: input,
    method: "POST",
  });
}

export function signInWithGoogle(idToken: string) {
  return apiRequest<AuthSession>("/api/v1/auth/google", {
    body: { idToken },
    method: "POST",
  });
}

export function refreshSession(refreshToken: string) {
  return apiRequest<AuthSession>("/api/v1/auth/refresh", {
    body: { refreshToken },
    method: "POST",
  });
}

export function logout(refreshToken: string) {
  return apiRequest<null>("/api/v1/auth/logout", {
    body: { refreshToken },
    method: "POST",
  });
}

export function listPublicHostels(
  query: {
    area?: string;
    facility?: string;
    food?: "veg" | "non-veg";
    maxPrice?: string;
    minPrice?: string;
    q?: string;
    roomType?: string;
    type?: "BOYS" | "GIRLS" | "CO_LIVING";
  } = {},
) {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });

  return apiRequest<{ hostels: PublicHostel[] }>(
    `/api/v1/public/hostels${params.size ? `?${params.toString()}` : ""}`,
  );
}

export function getPublicHostel(slug: string) {
  return apiRequest<{ hostel: PublicHostel }>(`/api/v1/public/hostels/${slug}`);
}

export function createPublicInquiry(
  hostelId: string,
  input: {
    message?: string;
    name: string;
    phone: string;
    preferredVisitDate?: string;
  },
) {
  return apiRequest<{
    inquiry: {
      id: string;
      status: string;
    };
  }>(`/api/v1/public/hostels/${hostelId}/inquiries`, {
    body: input,
    method: "POST",
  });
}

export function getActivationStatus(accessToken: string) {
  return apiRequest<{
    isActivated: boolean;
    resident: ResidentSummary | null;
  }>("/api/v1/resident/activation-status", {
    accessToken,
  });
}

export function activateResident(
  accessToken: string,
  input: {
    code: string;
    deviceInfo?: Record<string, unknown>;
    sessionInfo?: Record<string, unknown>;
  },
) {
  return apiRequest<AuthSession & { resident: ResidentSummary }>(
    "/api/v1/resident/activate",
    {
      accessToken,
      body: {
        code: input.code,
        deviceInfo: input.deviceInfo ?? {},
        sessionInfo: input.sessionInfo ?? {},
      },
      method: "POST",
    },
  );
}

export function getResidentDashboard(accessToken: string) {
  return apiRequest<{ dashboard: ResidentDashboard }>(
    "/api/v1/resident/dashboard",
    {
      accessToken,
    },
  );
}

export function getResidentProfile(accessToken: string) {
  return apiRequest<{
    profile: {
      emergencyContacts: Array<{
        id: string;
        name: string;
        phone: string;
        relation: string;
      }>;
      guardians: Array<{
        firstName: string;
        id: string;
        lastName: string;
        phone: string;
        relation: string;
      }>;
      resident: ResidentSummary;
      roomBed: ResidentDashboard["roomBed"];
    };
  }>("/api/v1/resident/profile", {
    accessToken,
  });
}

export function listResidentPayments(accessToken: string) {
  return apiRequest<{
    payments: ResidentPayment[];
    proofs: ResidentPaymentProof[];
  }>("/api/v1/resident/payments", {
    accessToken,
  });
}

export function submitPaymentProof(
  accessToken: string,
  paymentId: string,
  input: {
    proofImageAssetId: string;
    transactionCode?: string;
  },
) {
  return apiRequest<{
    proof: ResidentPaymentProof;
  }>(`/api/v1/resident/payments/${paymentId}/proof`, {
    accessToken,
    body: input,
    method: "POST",
  });
}

export function listResidentFood(accessToken: string) {
  return apiRequest<{
    photos: ResidentFoodPhoto[];
    routine: ResidentFoodRoutine;
  }>("/api/v1/resident/food", {
    accessToken,
  });
}

export function submitFoodFeedback(
  accessToken: string,
  input: {
    comment?: string;
    date: string;
    isAnonymous: boolean;
    mealType: string;
    menuId?: string;
    rating: number;
  },
) {
  return apiRequest<unknown>("/api/v1/resident/food/feedback", {
    accessToken,
    body: input,
    method: "POST",
  });
}

export function uploadResidentFoodPhoto(
  accessToken: string,
  input: {
    caption?: string;
    date: string;
    mealType: string;
    photoAssetId: string;
  },
) {
  return apiRequest<unknown>("/api/v1/resident/food/photos", {
    accessToken,
    body: input,
    method: "POST",
  });
}

export function listResidentNotices(accessToken: string) {
  return apiRequest<{
    notices: ResidentNotice[];
  }>("/api/v1/resident/notices", {
    accessToken,
  });
}

export function markNoticeAsRead(accessToken: string, noticeId: string) {
  return apiRequest<{
    notice: ResidentNotice;
  }>(`/api/v1/resident/notices/${noticeId}/read`, {
    accessToken,
    body: {},
    method: "PATCH",
  });
}

export function listResidentComplaints(accessToken: string) {
  return apiRequest<{
    complaints: ResidentComplaint[];
  }>("/api/v1/resident/complaints", {
    accessToken,
  });
}

export function createResidentComplaint(
  accessToken: string,
  input: {
    attachmentAssetIds?: string[];
    category: string;
    description: string;
    isAnonymous: boolean;
    title: string;
  },
) {
  return apiRequest<{ complaint: ResidentComplaint }>(
    "/api/v1/resident/complaints",
    {
      accessToken,
      body: input,
      method: "POST",
    },
  );
}

export function confirmComplaintResolution(
  accessToken: string,
  complaintId: string,
) {
  return apiRequest<{ complaint: ResidentComplaint }>(
    `/api/v1/resident/complaints/${complaintId}/confirm-resolution`,
    {
      accessToken,
      body: {},
      method: "PATCH",
    },
  );
}

export function getResidentNightStatus(accessToken: string) {
  return apiRequest<{ status: ResidentNightStatus }>(
    "/api/v1/resident/night-status",
    {
      accessToken,
    },
  );
}

export function updateResidentNightStatus(accessToken: string, status: string) {
  return apiRequest<{ status: ResidentNightStatus }>(
    "/api/v1/resident/night-status",
    {
      accessToken,
      body: { status },
      method: "POST",
    },
  );
}

export function triggerSOS(
  accessToken: string,
  input: { guardianAlertEnabled: boolean; message?: string },
) {
  return apiRequest<unknown>("/api/v1/resident/sos", {
    accessToken,
    body: input,
    method: "POST",
  });
}

export function submitResidentReview(
  accessToken: string,
  input: {
    cleanlinessRating?: number;
    comment?: string;
    foodRating?: number;
    overallRating: number;
    safetyRating?: number;
  },
) {
  return apiRequest<unknown>("/api/v1/resident/reviews", {
    accessToken,
    body: input,
    method: "POST",
  });
}

export function listNotifications(accessToken: string) {
  return apiRequest<{ notifications: NotificationItem[] }>(
    "/api/v1/notifications",
    {
      accessToken,
    },
  );
}

export function markNotificationRead(
  accessToken: string,
  notificationId: string,
) {
  return apiRequest<{ notification: NotificationItem }>(
    `/api/v1/notifications/${notificationId}/read`,
    {
      accessToken,
      body: {},
      method: "PATCH",
    },
  );
}

export function saveDeviceToken(
  accessToken: string,
  input: {
    deviceId?: string;
    platform: "IOS" | "ANDROID" | "WEB";
    token: string;
  },
) {
  return apiRequest<unknown>("/api/v1/mobile/device-token", {
    accessToken,
    body: input,
    method: "POST",
  });
}

export function getResidentReferral(accessToken: string) {
  return apiRequest<{
    referralCode: ResidentReferralCode;
    referrals: ResidentReferral[];
  }>("/api/v1/resident/referral", {
    accessToken,
  });
}
