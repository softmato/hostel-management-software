export const PRODUCT_NAME = "HostelHub";

export const API_VERSION = "v1";

export * from "./types/roles";
export * from "./types/enums";
export * from "./types/bed-type";
export * from "./utils/file-assets";
export { sendEmail } from "./email/sender";
export type { SendEmailInput, SendEmailResult } from "./email/sender";
