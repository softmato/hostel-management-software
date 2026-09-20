import {
  PUBLIC_CACHE,
  handleRouteError,
  successResponse,
} from "@/lib/api-response";
import { getPublicSiteConfig } from "@/modules/platform-config/site-config.service";

export const runtime = "nodejs";

/**
 * Read-only projection of the platform owner's website configuration. Cached at
 * the CDN rather than with `export const revalidate`: identical behaviour, but
 * the CDN cache is free and unmetered while the ISR cache it would otherwise
 * use is billed per write.
 */
export async function GET() {
  try {
    const config = await getPublicSiteConfig();

    return successResponse({ config }, "Site configuration loaded", PUBLIC_CACHE);
  } catch (error) {
    return handleRouteError(error);
  }
}
