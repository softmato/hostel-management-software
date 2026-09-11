import { NextResponse, type NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import { readResidentIdentitySignature } from "@/modules/users/resident-identity.service";

export const runtime = "nodejs";

/**
 * The photographed signature on the back of the card.
 *
 * Read-only, and only ever the caller's own — there is no id in the path, so
 * this endpoint cannot be pointed at anybody else's. Writing one goes through
 * the profile save (`PUT /users/resident-identity`, `signatureAssetId`), which
 * is where "drawn or photographed, not both" is decided.
 *
 * The bytes are streamed rather than redirected to R2 because the card is drawn
 * into a `<canvas>` and exported from it: a cross-origin image taints the
 * canvas and `toDataURL` throws. Same reason as the photo route beside it.
 */
export async function GET(request: NextRequest) {
  try {
    const principal = await requireApiPrincipal(request);
    const signature = await readResidentIdentitySignature(principal.userId);

    return new NextResponse(signature.body, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Type": signature.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
