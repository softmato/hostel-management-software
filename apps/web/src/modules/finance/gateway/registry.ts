import { esewaProvider } from "@/modules/finance/gateway/esewa.provider";
import { FinanceServiceError } from "@/modules/finance/finance.errors";
import type {
  GatewayProvider,
  GatewayProviderName,
} from "@/modules/finance/gateway/provider.types";

/**
 * Which adapters exist (plan item 6.2).
 *
 * A lookup rather than a `switch` in the intent service, so adding a provider is
 * one registration and nothing else changes. Providers are added here only once
 * they can do all three of create, parse and verify against a real environment —
 * a half-implemented adapter that throws at verification time fails *after* the
 * resident has paid, which is the worst place to discover it.
 */

/**
 * The adapters that ship today.
 *
 * Khalti lands in 6.5 and Fonepay in 6.8, and until each does, asking for one
 * raises rather than returning something half-built. An owner who has not been
 * offered a provider is a support question; a resident sent to a checkout that
 * throws after they have paid is a refund.
 */
const SHIPPED: GatewayProvider[] = [esewaProvider];

const adapters = new Map<GatewayProviderName, GatewayProvider>(
  SHIPPED.map((adapter) => [adapter.name, adapter]),
);

export function registerProvider(adapter: GatewayProvider): void {
  adapters.set(adapter.name, adapter);
}

export function getProvider(name: GatewayProviderName): GatewayProvider {
  const adapter = adapters.get(name);

  if (!adapter) {
    throw new FinanceServiceError(
      `Online payment through ${name} is not available yet.`,
      "GATEWAY_NOT_CONFIGURED",
    );
  }

  return adapter;
}

export function hasProvider(name: GatewayProviderName): boolean {
  return adapters.has(name);
}

/** Test seam. Restores the shipped set, never leaves the registry empty. */
export function resetProviders(): void {
  adapters.clear();

  for (const adapter of SHIPPED) {
    adapters.set(adapter.name, adapter);
  }
}
