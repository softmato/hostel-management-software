import { z } from "zod";

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),
  OTP_TTL_MINUTES: z.string().default("10"),
  OTP_RESEND_COOLDOWN_SECONDS: z.string().default("60"),
  OTP_RATE_LIMIT_WINDOW_MINUTES: z.string().default("15"),
  OTP_RATE_LIMIT_MAX: z.string().default("5"),
  OTP_HASH_SECRET: z.string().optional(),
  EMAIL_OTP_PROVIDER: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),
  SMS_OTP_PROVIDER: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_PHONE: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  /**
   * 32-byte key (base64 or hex) that encrypts the resident identity profiles.
   * Optional here so existing deployments keep booting; the resident-profile
   * endpoints fail with a clear message when it is absent.
   */
  PERSONAL_DATA_ENCRYPTION_KEY: z.string().optional(),
  /**
   * QuestionCall partner integration (ARCHITECTURE.md §12). All optional: with
   * no SSO secret the study link still works as a plain outbound link, and with
   * no webhook secret the conversion callback returns 503 instead of trusting
   * an unauthenticated caller.
   */
  QUESTIONCALL_URL: z.string().url().optional(),
  QUESTIONCALL_SSO_SECRET: z.string().optional(),
  QUESTIONCALL_WEBHOOK_SECRET: z.string().optional(),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  LOG_LEVEL: z.string().default("info"),
  PUBLIC_FORM_RATE_LIMIT_MAX: z.string().default("10"),
  PUBLIC_FORM_RATE_LIMIT_WINDOW_SECONDS: z.string().default("60"),
  UPLOAD_MAX_IMAGE_BYTES: z.string().default("5242880"),
  UPLOAD_MAX_DOCUMENT_BYTES: z.string().default("10485760"),
  ALLOWED_IMAGE_MIME_TYPES: z.string().default("image/jpeg,image/png,image/webp"),
  ALLOWED_DOCUMENT_MIME_TYPES: z
    .string()
    .default("application/pdf,image/jpeg,image/png,image/webp"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function validateServerEnv() {
  return serverEnvSchema.parse(process.env);
}
