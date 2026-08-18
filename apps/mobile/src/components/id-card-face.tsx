import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { View } from "react-native";

import { Text } from "@/components/ui/text";
import { APP_NAME } from "@/constants/branding";
import { CARD_ASPECT, CARD_COLORS, type IdCard } from "@/lib/id-card";

/**
 * One face of the ID card.
 *
 * ## Every colour here is a literal, on purpose
 *
 * This is the only component in the app that ignores the theme. The card is a
 * *document*: `apps/web` paints these same values onto a canvas for the preview,
 * the downloaded PNG and the image attached to the holder's email, and the reason
 * given there applies just as much on a phone — an ID card that turns dark
 * because the viewer had dark mode on is not an ID card. A warden comparing the
 * card on a resident's screen against the one in their inbox has to see the same
 * document.
 *
 * The layout follows `drawFront`/`drawBack` in `apps/web/src/lib/platform-id-card.ts`
 * rather than reinventing an arrangement, so the two read as one issued thing.
 * It is *not* pixel-identical — those are canvas coordinates on a fixed 640×1000
 * grid, and this has to survive a 320dp phone and a 500dp tablet — so it keeps
 * the order, the hierarchy and the copy, and lets flexbox place them.
 */

const NAME_LETTER_SPACING = 0.4;

export function IdCardFace({
  card,
  face,
  photo,
  qrDataUrl,
  siteLabel,
}: {
  card: IdCard;
  face: "back" | "front";
  /** An `<Image source>` for the holder's portrait, or null. */
  photo: { headers?: Record<string, string>; uri: string } | null;
  /** `data:` PNG from the server. **Null is a real case** — see below. */
  qrDataUrl: string | null;
  siteLabel: string;
}) {
  return (
    <View
      style={{
        aspectRatio: CARD_ASPECT,
        backgroundColor: CARD_COLORS.paper,
        borderColor: CARD_COLORS.hairline,
        borderRadius: 20,
        borderWidth: 1,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <CardHeader card={card} tall={face === "front"} />

      {face === "front" ? (
        <CardFront card={card} photo={photo} qrDataUrl={qrDataUrl} />
      ) : (
        <CardBack card={card} siteLabel={siteLabel} />
      )}

      {/* The footer sweep, in the accent rather than the brand — matching
          `drawFooterSweep`, which is what closes the card visually. */}
      <View style={{ backgroundColor: card.accent, height: 10 }} />
    </View>
  );
}

/** The brand lockup on its coloured sweep. Shorter on the back, as on the web. */
function CardHeader({ card, tall }: { card: IdCard; tall: boolean }) {
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: CARD_COLORS.brand,
        borderBottomLeftRadius: tall ? 56 : 40,
        borderBottomRightRadius: tall ? 56 : 40,
        gap: 4,
        paddingBottom: tall ? 22 : 16,
        paddingHorizontal: 16,
        paddingTop: tall ? 18 : 14,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
        <Ionicons color={CARD_COLORS.paper} name="home" size={15} />
        <Text
          style={{
            color: CARD_COLORS.paper,
            fontSize: 15,
            fontWeight: "800",
            letterSpacing: 1,
          }}
        >
          {APP_NAME}
        </Text>
      </View>

      <Text
        numberOfLines={1}
        style={{
          color: CARD_COLORS.paper,
          fontSize: 9,
          fontWeight: "700",
          letterSpacing: 1.4,
          opacity: 0.9,
        }}
      >
        {card.title}
      </Text>
    </View>
  );
}

function CardFront({
  card,
  photo,
  qrDataUrl,
}: {
  card: IdCard;
  photo: { headers?: Record<string, string>; uri: string } | null;
  qrDataUrl: string | null;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        flex: 1,
        paddingBottom: 8,
        paddingHorizontal: 18,
        paddingTop: 12,
      }}
    >
      <Portrait card={card} photo={photo} />

      <Text
        numberOfLines={1}
        style={{
          color: CARD_COLORS.ink,
          fontSize: 17,
          fontWeight: "800",
          letterSpacing: NAME_LETTER_SPACING,
          marginTop: 8,
        }}
      >
        {card.fullName}
      </Text>

      <Text
        numberOfLines={1}
        style={{
          color: CARD_COLORS.brand,
          fontSize: 9,
          fontWeight: "700",
          letterSpacing: 1.6,
          marginTop: 3,
        }}
      >
        {card.role.toUpperCase()}
      </Text>

      <View
        style={{
          backgroundColor: CARD_COLORS.hairline,
          height: 1,
          marginTop: 10,
          width: "76%",
        }}
      />

      <View style={{ gap: 4, marginTop: 10, width: "100%" }}>
        {card.rows.map(([label, value]) => (
          <View key={label} style={{ flexDirection: "row", gap: 6 }}>
            <Text
              style={{
                color: CARD_COLORS.brand,
                fontSize: 9,
                fontWeight: "800",
                letterSpacing: 0.6,
                width: 52,
              }}
            >
              {label}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                color: CARD_COLORS.ink,
                flex: 1,
                fontSize: 10,
                fontWeight: "600",
              }}
            >
              {value}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ alignItems: "center", flex: 1, justifyContent: "flex-end" }}>
        <Qr qrDataUrl={qrDataUrl} residentId={card.residentId} />
      </View>
    </View>
  );
}

function Portrait({
  card,
  photo,
}: {
  card: IdCard;
  photo: { headers?: Record<string, string>; uri: string } | null;
}) {
  const size = 78;

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: CARD_COLORS.paper,
        borderColor: card.accent,
        borderRadius: size / 2,
        borderWidth: 3,
        height: size,
        justifyContent: "center",
        overflow: "hidden",
        width: size,
      }}
    >
      {photo ? (
        <Image
          contentFit="cover"
          source={photo}
          style={{ height: "100%", width: "100%" }}
        />
      ) : (
        // An initial, not a generic silhouette: a card with a grey person icon
        // reads as a card that failed to load rather than one with no photo.
        <Text
          style={{ color: CARD_COLORS.brand, fontSize: 30, fontWeight: "800" }}
        >
          {card.fullName.trim().charAt(0).toUpperCase() || "?"}
        </Text>
      )}
    </View>
  );
}

/**
 * The QR, or the typed id when the server could not render one.
 *
 * `getResidentIdentityQr` wraps its `qrcode` import in a `try` and returns
 * **`null` with a 200** on failure, so this is a real state and not a loading
 * one. The id in large monospaced-feeling caps is the manual-entry path the
 * server's own comment points at, so the card still works at a desk.
 */
function Qr({
  qrDataUrl,
  residentId,
}: {
  qrDataUrl: string | null;
  residentId: string;
}) {
  return (
    <View style={{ alignItems: "center", gap: 5 }}>
      <View
        style={{
          alignItems: "center",
          backgroundColor: CARD_COLORS.paper,
          borderColor: CARD_COLORS.hairline,
          borderRadius: 10,
          borderWidth: 1,
          height: 96,
          justifyContent: "center",
          padding: 5,
          width: 96,
        }}
      >
        {qrDataUrl ? (
          <Image
            contentFit="contain"
            source={{ uri: qrDataUrl }}
            style={{ height: "100%", width: "100%" }}
          />
        ) : (
          <Text
            style={{
              color: CARD_COLORS.ink,
              fontSize: 13,
              fontWeight: "800",
              letterSpacing: 1,
              textAlign: "center",
            }}
          >
            {residentId}
          </Text>
        )}
      </View>

      <Text
        style={{
          color: CARD_COLORS.muted,
          fontSize: 8,
          fontWeight: "600",
          letterSpacing: 1,
        }}
      >
        {qrDataUrl ? "SCAN TO SHARE MY DETAILS" : "READ THIS ID OUT INSTEAD"}
      </Text>
    </View>
  );
}

function CardBack({ card, siteLabel }: { card: IdCard; siteLabel: string }) {
  return (
    <View style={{ flex: 1, paddingBottom: 10, paddingHorizontal: 20, paddingTop: 16 }}>
      <Text
        style={{
          color: CARD_COLORS.brand,
          fontSize: 10,
          fontWeight: "800",
          letterSpacing: 1,
        }}
      >
        HOW THIS CARD WORKS
      </Text>

      <View style={{ gap: 9, marginTop: 12 }}>
        {card.backBullets.map((bullet) => (
          <View key={bullet} style={{ flexDirection: "row", gap: 8 }}>
            <View
              style={{
                backgroundColor: card.accent,
                borderRadius: 3,
                height: 6,
                marginTop: 4,
                width: 6,
              }}
            />
            <Text
              style={{
                color: CARD_COLORS.muted,
                flex: 1,
                fontSize: 10,
                fontWeight: "500",
                lineHeight: 14,
              }}
            >
              {bullet}
            </Text>
          </View>
        ))}
      </View>

      <View
        style={{ backgroundColor: CARD_COLORS.hairline, height: 1, marginTop: 14 }}
      />

      <Text
        style={{
          color: CARD_COLORS.brand,
          fontSize: 8,
          fontWeight: "800",
          letterSpacing: 1.6,
          marginTop: 14,
        }}
      >
        {card.idLabel}
      </Text>

      <Text
        style={{
          color: CARD_COLORS.ink,
          fontSize: 19,
          fontWeight: "800",
          letterSpacing: 1.6,
          marginTop: 3,
        }}
      >
        {card.residentId}
      </Text>

      <Text style={{ color: CARD_COLORS.muted, fontSize: 9, marginTop: 4 }}>
        Issued {card.issuedOn}
      </Text>

      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        {/* The signature rule from the reference back face. Dashed via a border,
            since React Native has no `setLineDash`. */}
        <View
          style={{
            borderColor: CARD_COLORS.hairline,
            borderStyle: "dashed",
            borderTopWidth: 1,
            width: "58%",
          }}
        />
        <Text style={{ color: CARD_COLORS.muted, fontSize: 9, marginTop: 5 }}>
          Cardholder signature
        </Text>

        <Text
          style={{
            color: CARD_COLORS.ink,
            fontSize: 9,
            fontWeight: "700",
            marginTop: 12,
          }}
        >
          {siteLabel}
        </Text>
      </View>
    </View>
  );
}
