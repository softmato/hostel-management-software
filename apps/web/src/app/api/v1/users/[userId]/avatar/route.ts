import { NextResponse, type NextRequest } from "next/server";

import { requireApiPrincipal } from "@/lib/api-auth";
import { handleRouteError } from "@/lib/api-response";
import { readAccountAvatarPhoto } from "@/modules/users/resident-identity.service";

export const runtime = "nodejs";

/**
 * One account's profile picture — the photo its owner put on their ID card.
 *
 * This is the URL stored in `User.image`, so it is what every avatar in the
 * product resolves to: the signed-in header, a resident's row on the roster, a
 * community post's author. Streamed rather than redirected, because the bucket
 * is private and a 302 to a presigned URL loses the caller's `Authorization`
 * header on the hop — the mobile app sends a bearer token, not a cookie.
 *
 * Any signed-in caller may read it, and `readAccountAvatarPhoto` decides what
 * that means: it serves only a photo the account is *presenting* as its avatar,
 * and there is no asset id in the path, so this cannot be walked across the
 * bucket. The stricter, sharing-gated read of somebody's card photo is
 * `/hostel-admin/resident-scan/photo`, which answers a different question.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    await requireApiPrincipal(request);

    const { userId } = await params;
    const photo = await readAccountAvatarPhoto(userId);

    return new NextResponse(photo.body, {
      headers: {
        // Private: a face must not be held by a shared cache. Five minutes is
        // the same window the other photo routes use, and `?v=` busts it the
        // moment somebody replaces their picture.
        "Cache-Control": "private, max-age=300",
        "Content-Type": photo.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
