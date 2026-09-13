export { PLATFORM_NAME as PRODUCT_NAME, PLATFORM_NAME } from "./brand/brand";

export const API_VERSION = "v1";

export * from "./types/roles";
export * from "./types/enums";
export * from "./types/bed-type";
export * from "./utils/file-assets";
export { sendEmail } from "./email/sender";
export type { SendEmailInput, SendEmailResult } from "./email/sender";
