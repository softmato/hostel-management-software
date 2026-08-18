import { Image } from "expo-image";
import { useState } from "react";
import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { avatarInitial, avatarToneIndex } from "@/lib/avatar";

/**
 * A person, a hostel, or a placeholder for either.
 *
 * ## The fallback is the normal case
 *
 * Almost nobody on this platform has uploaded a photo — `user.image` is null
 * for every account that did not sign in with Google — so the initial circle is
 * what most rows render, and a grey silhouette on every row of a resident list
 * tells the reader nothing. A deterministic colour per name at least makes two
 * adjacent rows distinguishable at a glance.
 *
 * The tone table is derived from `name`, not from the account id, so it matches
 * the web's `community-post-card.tsx` for the same person.
 *
 * ## `onError`, not just a null check
 *
 * A private asset URL that 401s, an expired Google photo, and a deleted object
 * all return a URL that *exists* and cannot be drawn. Without the error swap,
 * those render as an empty hole rather than as the initial the row would have
 * had anyway.
 */

const TONES = [
  { background: "bg-primary", foreground: "text-primary-foreground" },
  { background: "bg-role-admin-soft", foreground: "text-role-admin" },
  { background: "bg-warning-soft", foreground: "text-warning" },
  { background: "bg-success-soft", foreground: "text-success" },
  { background: "bg-muted", foreground: "text-muted-foreground" },
] as const;

const SIZES = {
  lg: { font: "text-2xl", px: 64 },
  md: { font: "text-base", px: 40 },
  sm: { font: "text-xs", px: 28 },
  /** Icon-sized, for the Profile tab — it sits in a row of 23px glyphs. */
  xs: { font: "text-[10px]", px: 22 },
  xl: { font: "text-3xl", px: 96 },
} as const;

export function Avatar({
  className = "",
  /** Only for our own authorising `/files/{id}/url` route; a public URL needs none. */
  headers,
  name,
  size = "md",
  uri,
}: {
  className?: string;
  headers?: Record<string, string>;
  name: string | null | undefined;
  size?: keyof typeof SIZES;
  uri?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const { font, px } = SIZES[size];
  const tone = TONES[avatarToneIndex(name, TONES.length)];
  const showImage = Boolean(uri) && !failed;

  return (
    /*
     * The wrapper carries the caller's `className`, not the image.
     * `expo-image` is a third-party component, so NativeWind only styles it
     * through an explicit `cssInterop` registration this app does not have —
     * a `className` on it is silently dropped, and a margin that silently does
     * nothing is worse than one that is not offered.
     */
    <View
      accessibilityLabel={name ?? undefined}
      className={`items-center justify-center overflow-hidden ${
        showImage ? "" : tone.background
      } ${className}`}
      style={{ borderRadius: px / 2, height: px, width: px }}
    >
      {showImage ? (
        <Image
          contentFit="cover"
          onError={() => setFailed(true)}
          source={{ headers, uri: uri as string }}
          style={{ height: px, width: px }}
        />
      ) : (
        <Text className={`font-bold ${font} ${tone.foreground}`}>
          {avatarInitial(name)}
        </Text>
      )}
    </View>
  );
}
