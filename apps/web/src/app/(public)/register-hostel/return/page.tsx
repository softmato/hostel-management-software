import { redirect } from "next/navigation";

/**
 * The return address plan checkouts used before `/checkout/return`. A session
 * opened just before a deploy still comes back here, so it forwards — query
 * string and all — to the one return page every platform payment now uses.
 */
export default async function LegacyCheckoutReturn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value);
  }

  redirect(`/checkout/return${query.size ? `?${query}` : ""}`);
}
