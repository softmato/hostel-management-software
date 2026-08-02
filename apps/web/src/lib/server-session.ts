import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth-cookies";
import { verifyAccessToken } from "@/lib/auth";
import { Role } from "@/lib/roles";

/**
 * The signed-in role, read from the access-token cookie in a server component.
 *
 * Returns `null` when there is no valid session — including in development,
 * where `proxy.ts` skips the auth guard entirely. Callers use it to *hide* what
 * a role may not reach; the real gate is the route rule plus the API guard, so a
 * null here can never grant access to anything.
 */
export async function sessionRole(): Promise<Role | null> {
  const store = await cookies();
  const token = store.get(ACCESS_TOKEN_COOKIE)?.value;

  if (!token) {
    return null;
  }

  try {
    const payload = await verifyAccessToken(token);

    return typeof payload.role === "string" ? (payload.role as Role) : null;
  } catch {
    return null;
  }
}
