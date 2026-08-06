import { redirect } from "next/navigation";

/**
 * There is one provider surface now — `/service-providers` *is* the registration
 * funnel. This path is kept because it is linked from the home page and older
 * emails, and because it was in the sitemap.
 */
export default function ServiceProviderRegisterPage() {
  redirect("/service-providers");
}
