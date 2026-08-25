import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image, Pressable, TextInput, View } from "react-native";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Grid } from "@/components/ui/layout";
import { Money } from "@/components/ui/money";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useSystemInsets } from "@/hooks/use-system-insets";
import { API_BASE_URL } from "@/lib/api";
import { absoluteMediaUrl } from "@/lib/media";
import type { StoreCategory, StoreProduct } from "@/lib/store-api";
import { discountPercent, rupees, stepperBounds } from "@/lib/store-format";

/**
 * The shop's own vocabulary — the parts a hostel-supply catalogue needs that
 * the rest of the app has no use for.
 *
 * ## What was reused instead of rebuilt
 *
 * `Card`, `Badge`, `Money`, `Skeleton` and `Text` are the app's, unchanged. What
 * is here is only what a catalogue actually adds: a product tile with a
 * photograph and a price, a quantity stepper, a search field, and a category
 * tile. Everything else on these screens — the app bar, the sheets, the empty
 * states, the list rows — is `components/ui/`.
 *
 * ## Colour
 *
 * The reference boards this was drawn from are an orange grocery app and a blue
 * fashion app. Neither colour appears here: prices, badges and the "add"
 * controls are `--primary`, and the semantic tones carry meaning only
 * (`ui_inspiration_folder/app_recordings/NOTES.md`, "take layout, never
 * colour"). The layouts *are* theirs — the two-up product grid, the horizontal
 * deals rail, the image-led cart row with a stepper on the right.
 */

/** Corner radius on product artwork. Matches `Card`'s `rounded-2xl` at 16. */
const IMAGE_RADIUS = 14;

/**
 * Resolves a product image to something `<Image>` can actually load.
 *
 * Products carry either an uploaded `assetId` or a supplier's absolute URL, so
 * this has to handle both — and `absoluteMediaUrl` is what turns the relative
 * `/api/v1/files/…` form into an origin the phone has. Returns `null` when
 * there is nothing, which is a real case: a catalogue is stocked before it is
 * photographed.
 */
export function productImageUri(product: {
  images: { assetId: string; url: string }[];
}): string | null {
  const image = product.images[0];

  if (!image) {
    return null;
  }

  const raw =
    image.url || (image.assetId ? `/api/v1/files/${image.assetId}/url` : "");

  return raw ? absoluteMediaUrl(raw, API_BASE_URL) : null;
}

/**
 * The placeholder behind a product with no photograph.
 *
 * A tinted block with a glyph rather than a grey rectangle: the grid reads as a
 * shop either way, and a column of empty grey boxes reads as a failed load.
 */
function ProductArtwork({
  product,
  radius = IMAGE_RADIUS,
}: {
  product: StoreProduct;
  radius?: number;
}) {
  const { colors } = useAppTheme();
  const uri = productImageUri(product);

  if (!uri) {
    return (
      <View
        className="h-full w-full items-center justify-center bg-brand-soft"
        style={{ borderRadius: radius }}
      >
        <Ionicons color={colors.primary} name="cube-outline" size={26} />
      </View>
    );
  }

  return (
    <Image
      className="h-full w-full"
      resizeMode="cover"
      source={{ uri }}
      style={{ borderRadius: radius }}
    />
  );
}

/**
 * The in-basket control on a shop card: a filled brand pill that takes the exact
 * place the `Add` button had.
 *
 * ## Not `QuantityStepper`
 *
 * That one is the cart screen's: a bordered box on a white row, sized for a
 * screen whose whole job is adjusting quantities. Dropped onto a product tile it
 * read as a stray form field — an outlined widget floating under a price, with
 * no visual tie to the button it replaced.
 *
 * This is the same *behaviour* wearing the `Add` button's clothes: same height,
 * same radius, same `--primary` fill, so a product moving in and out of the
 * basket changes what the control says and never where it sits or how big it is.
 * Grocery references do exactly this, and it is the reason the swap does not
 * make the card jump.
 *
 * ## The minus becomes a bin at the floor
 *
 * Stepping to zero is how everyone expects to empty a line, and a minus that
 * simply stops responding at one is the most common complaint about this
 * control. `onRemove` is therefore required here, unlike on `QuantityStepper`.
 *
 * ## Nothing here disables on `busy`
 *
 * The quantity shown is already optimistic — see `useAddToCart` — so a second
 * tap has a correct number to work from, and blocking it would put back exactly
 * the lag the optimism removed. `accessibilityState` still reports `busy`, so a
 * screen reader is told what the eye can see.
 */
function CartStepper({
  busy,
  fullWidth = false,
  onChange,
  onRemove,
  product,
  quantity,
}: {
  busy: boolean;
  /** Spans the card. Off for a list row, where the control sits beside content. */
  fullWidth?: boolean;
  onChange: (next: number) => void;
  onRemove: () => void;
  product: Pick<StoreProduct, "maxOrderQuantity" | "minOrderQuantity" | "stockQuantity">;
  quantity: number;
}) {
  const { colors } = useAppTheme();
  const bounds = stepperBounds(product);
  const atFloor = quantity <= bounds.min;
  const atCeiling = quantity >= bounds.max;

  return (
    <View
      accessibilityState={{ busy }}
      className={`h-9 flex-row items-center overflow-hidden rounded-xl bg-primary ${
        fullWidth ? "w-full" : ""
      }`}
      style={fullWidth ? undefined : { width: 104 }}
    >
      <Pressable
        accessibilityLabel={atFloor ? "Remove from cart" : "Decrease quantity"}
        accessibilityRole="button"
        className="h-full w-9 items-center justify-center active:opacity-70"
        hitSlop={4}
        onPress={() => {
          void Haptics.selectionAsync();

          if (atFloor) {
            onRemove();
            return;
          }

          onChange(quantity - 1);
        }}
      >
        <Ionicons
          color={colors.primaryForeground}
          name={atFloor ? "trash-outline" : "remove"}
          size={16}
        />
      </Pressable>

      <Text
        className="flex-1 text-center text-sm font-bold"
        // The digits hold their own column so the pill does not shift a pixel
        // every time the count crosses ten.
        style={{ color: colors.primaryForeground, minWidth: 24 }}
      >
        {quantity}
      </Text>

      <Pressable
        accessibilityLabel="Increase quantity"
        accessibilityRole="button"
        className={`h-full w-9 items-center justify-center active:opacity-70 ${
          atCeiling ? "opacity-40" : ""
        }`}
        disabled={atCeiling}
        hitSlop={4}
        onPress={() => {
          void Haptics.selectionAsync();
          onChange(quantity + 1);
        }}
      >
        <Ionicons color={colors.primaryForeground} name="add" size={16} />
      </Pressable>
    </View>
  );
}

/**
 * A product as a tile, for the two-up grid.
 *
 * The price sits **under** the name rather than beside it, and the add control
 * is a circle in the bottom-right corner — the arrangement in the second
 * reference board, and the one that survives a 40-character product name
 * without the price being pushed off the row.
 *
 * `onAdd` is optional. On the shop grid it is the whole point; on the "related"
 * rail of a product screen it is absent, because a tap there should open the
 * product, and two tap targets in a 150dp tile is how people add the wrong
 * thing.
 *
 * ## Once it is in the basket the button becomes a stepper
 *
 * It used to become a **tick**, which was wrong twice over: a tick is the
 * universal "done" mark, so tapping it to *remove* the item is what everybody
 * tried — and what it actually did was add another one. There was also no way
 * to take something out of the basket from this screen at all.
 *
 * So `onSetQuantity` replaces it with `QuantityStepper`, the same control the
 * cart screen uses, which turns its minus into a bin at the floor. One control,
 * one meaning, on both screens.
 */
export function ProductCard({
  busy = false,
  inCart,
  onAdd,
  onPress,
  onSetQuantity,
  product,
}: {
  busy?: boolean;
  inCart?: number;
  onAdd?: () => void;
  onPress: () => void;
  /** Absolute quantity, `0` to remove. Without it the card never shows a stepper. */
  onSetQuantity?: (next: number) => void;
  product: StoreProduct;
}) {
  const { colors } = useAppTheme();
  const discount = discountPercent(product.price, product.compareAtPrice);
  const stepping = (inCart ?? 0) > 0 && Boolean(onSetQuantity);

  return (
    <Pressable
      accessibilityLabel={product.name}
      accessibilityRole="button"
      className="active:opacity-80"
      onPress={onPress}
    >
      <Card className="gap-2.5" padding="p-2.5">
        <View className="aspect-square w-full">
          <ProductArtwork product={product} />

          {discount ? (
            <View className="absolute left-1.5 top-1.5">
              <Badge label={`${discount}% off`} tone="danger" />
            </View>
          ) : null}

          {/*
            The out-of-stock veil sits over the artwork rather than replacing the
            card. A shop that hides what it has run out of looks smaller than it
            is, and somebody looking for the thing they bought last month needs
            to find it and be told, not to conclude it was never sold here.
          */}
          {product.inStock ? null : (
            <View
              className="absolute inset-0 items-center justify-center bg-background/70"
              style={{ borderRadius: IMAGE_RADIUS }}
            >
              <Badge label="Out of stock" tone="neutral" />
            </View>
          )}
        </View>

        <View className="gap-0.5">
          <Text
            className="text-[13px] font-semibold text-foreground"
            numberOfLines={2}
          >
            {product.name}
          </Text>
          <Text className="text-[11px] text-muted-foreground" numberOfLines={1}>
            per {product.unit}
          </Text>
        </View>

        <View className="gap-2">
          <View className="flex-row items-end justify-between gap-2">
            <View className="flex-1">
              <Money size="inline" value={rupees(product.price)} />
              {product.compareAtPrice ? (
                <Text className="text-[11px] text-muted-foreground line-through">
                  {`NPR ${((product.compareAtPrice ?? 0) / 100).toLocaleString("en-NP")}`}
                </Text>
              ) : null}
            </View>

            {onAdd && !stepping ? (
              <Pressable
                accessibilityLabel={`Add ${product.name} to cart`}
                accessibilityRole="button"
                accessibilityState={{ busy, disabled: !product.inStock }}
                /*
                  No busy styling and no busy disable. The control swaps to the
                  stepper on the same frame as the tap — see `useAddToCart` — so
                  there is no in-flight moment left to draw, and dimming one
                  would only put back the flicker this replaced.
                */
                className={`h-9 w-9 items-center justify-center rounded-xl active:opacity-70 ${
                  product.inStock ? "bg-primary" : "bg-muted"
                }`}
                disabled={!product.inStock}
                hitSlop={6}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onAdd();
                }}
              >
                <Ionicons
                  color={
                    product.inStock
                      ? colors.primaryForeground
                      : colors.mutedForeground
                  }
                  name="add"
                  size={20}
                />
              </Pressable>
            ) : null}
          </View>

          {/*
            Its own row rather than beside the price: a 104dp stepper and a
            "NPR 12,450" both fit on one line right up until they do not, and
            what gives way first is the price.
          */}
          {stepping ? (
            <CartStepper
              busy={busy}
              fullWidth
              onChange={(next) => onSetQuantity?.(next)}
              onRemove={() => onSetQuantity?.(0)}
              product={product}
              quantity={inCart ?? 0}
            />
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * A product as a full-width row — the "Crazy Offer" list in the first reference
 * board, and what a search result should be.
 *
 * A row rather than a tile whenever the list is long and the decision is
 * "is this the one I meant": a 96dp thumbnail beside two lines of text is read
 * faster than a grid of squares, and it leaves room for the summary line that a
 * tile has to drop.
 */
export function ProductRow({
  busy = false,
  inCart,
  onAdd,
  onPress,
  onSetQuantity,
  product,
}: {
  busy?: boolean;
  inCart?: number;
  onAdd?: () => void;
  onPress: () => void;
  /** Absolute quantity, `0` to remove — see `ProductCard`. */
  onSetQuantity?: (next: number) => void;
  product: StoreProduct;
}) {
  const { colors } = useAppTheme();
  const stepping = (inCart ?? 0) > 0 && Boolean(onSetQuantity);

  return (
    <Pressable
      accessibilityLabel={product.name}
      accessibilityRole="button"
      className="active:opacity-80"
      onPress={onPress}
    >
      <Card className="flex-row items-center gap-3" padding="p-3">
        <View className="h-20 w-20">
          <ProductArtwork product={product} radius={12} />
        </View>

        <View className="min-w-0 flex-1 gap-1">
          <Text
            className="text-sm font-semibold text-foreground"
            numberOfLines={2}
          >
            {product.name}
          </Text>
          {product.summary ? (
            <Text
              className="text-[11px] text-muted-foreground"
              numberOfLines={1}
            >
              {product.summary}
            </Text>
          ) : null}
          <View className="flex-row items-center gap-2">
            <Money size="inline" value={rupees(product.price)} />
            <Text className="text-[11px] text-muted-foreground">
              / {product.unit}
            </Text>
          </View>
        </View>

        {stepping ? (
          <CartStepper
            busy={busy}
            onChange={(next) => onSetQuantity?.(next)}
            onRemove={() => onSetQuantity?.(0)}
            product={product}
            quantity={inCart ?? 0}
          />
        ) : onAdd ? (
          <Pressable
            accessibilityLabel={`Add ${product.name} to cart`}
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: !product.inStock }}
            className={`h-9 items-center justify-center rounded-xl border px-3 active:opacity-70 ${
              product.inStock
                ? "border-primary/40 bg-brand-soft"
                : "border-border bg-muted"
            }`}
            disabled={!product.inStock}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onAdd();
            }}
          >
            <Text
              className={`text-xs font-semibold ${
                product.inStock ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {product.inStock ? "Add" : "Sold out"}
            </Text>
          </Pressable>
        ) : (
          <Ionicons
            color={colors.mutedForeground}
            name="chevron-forward"
            size={16}
          />
        )}
      </Card>
    </Pressable>
  );
}

/**
 * A department, as an icon tile.
 *
 * The one rule every reference in `ui_inspiration_folder` agrees on: a menu of
 * destinations is a grid of tinted glyphs with a short label, never full-width
 * rows of sentences. The count under the name is the caption `InfoTile` would
 * have carried; this is a near-twin of that component and deliberately not the
 * same one — a category tile is square artwork first and a glyph only when
 * there is no photograph, which `InfoTile` has no slot for.
 */
export function CategoryTile({
  category,
  compact = false,
  onPress,
  selected = false,
}: {
  category: StoreCategory;
  /**
   * The shop screen's shortcut strip, where these are a *row of doors* above the
   * products rather than the content of the screen. Same tile, smaller: the
   * departments tab is where they are the subject and keep their full size.
   */
  compact?: boolean;
  onPress: () => void;
  selected?: boolean;
}) {
  const { colors } = useAppTheme();
  const uri = category.imageUrl
    ? absoluteMediaUrl(category.imageUrl, API_BASE_URL)
    : category.imageAssetId
      ? absoluteMediaUrl(
          `/api/v1/files/${category.imageAssetId}/url`,
          API_BASE_URL,
        )
      : null;

  return (
    <Pressable
      accessibilityLabel={category.name}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="active:opacity-70"
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
    >
      <View
        className={`items-center justify-center rounded-2xl border px-2 ${
          compact ? "min-h-[80px] gap-1.5 py-2" : "min-h-[104px] gap-2 py-3"
        } ${selected ? "border-primary bg-brand-soft" : "border-border bg-card"}`}
      >
        <View
          className={`items-center justify-center overflow-hidden rounded-xl bg-brand-soft ${
            compact ? "h-9 w-9" : "h-12 w-12"
          }`}
        >
          {uri ? (
            <Image
              className="h-full w-full"
              resizeMode="cover"
              source={{ uri }}
            />
          ) : (
            <Ionicons
              color={colors.primary}
              name={category.icon as keyof typeof Ionicons.glyphMap}
              size={compact ? 17 : 21}
            />
          )}
        </View>

        <View className="items-center gap-0.5">
          <Text
            className="text-center font-medium text-foreground"
            numberOfLines={2}
            style={{ fontSize: compact ? 10 : 11 }}
          >
            {category.name}
          </Text>
          <Text
            className="text-center text-muted-foreground"
            style={{ fontSize: compact ? 9 : 11 }}
          >
            {category.productCount}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The search field that rides on the painted header.
 *
 * A white pill on the accent block, straddling nothing — it sits *inside* the
 * colour, which is where both reference boards put it. It is a plain
 * `TextInput` rather than `<Input>`: that component draws a bordered card field
 * with a label above it, which is the right thing in a form and the wrong thing
 * on a coloured bar.
 */
export function StoreSearchField({
  autoFocus = false,
  onChangeText,
  onSubmit,
  placeholder = "Search the store",
  value,
}: {
  autoFocus?: boolean;
  onChangeText: (next: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  value: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View className="h-11 flex-row items-center gap-2 rounded-2xl bg-card px-3.5">
      <Ionicons color={colors.mutedForeground} name="search" size={17} />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        className="flex-1 text-sm text-foreground"
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        returnKeyType="search"
        value={value}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => onChangeText("")}
        >
          <Ionicons
            color={colors.mutedForeground}
            name="close-circle"
            size={17}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Minus, a number, plus.
 *
 * The bounds come from `stepperBounds`, which reads the server's own vocabulary
 * — `maxOrderQuantity: 0` is "no cap", `stockQuantity: null` is "not tracked" —
 * so a disabled plus button here always has a reason the server would give too.
 *
 * At the floor the minus turns into a **bin**. Stepping to zero is how everyone
 * expects to empty a cart line, and a minus that simply stops working at one is
 * the most common complaint about this control.
 */
export function QuantityStepper({
  busy = false,
  onChange,
  onRemove,
  product,
  quantity,
}: {
  busy?: boolean;
  onChange: (next: number) => void;
  onRemove?: () => void;
  product: Pick<
    StoreProduct,
    "maxOrderQuantity" | "minOrderQuantity" | "stockQuantity"
  >;
  quantity: number;
}) {
  const { colors } = useAppTheme();
  const bounds = stepperBounds(product);
  const atFloor = quantity <= bounds.min;
  const atCeiling = quantity >= bounds.max;

  return (
    <View className="h-9 flex-row items-center rounded-xl border border-border bg-card">
      <Pressable
        accessibilityLabel={
          atFloor && onRemove ? "Remove from cart" : "Decrease quantity"
        }
        accessibilityRole="button"
        className="h-full w-9 items-center justify-center active:opacity-60"
        disabled={busy || (atFloor && !onRemove)}
        onPress={() => {
          void Haptics.selectionAsync();

          if (atFloor) {
            onRemove?.();
            return;
          }

          onChange(quantity - 1);
        }}
      >
        <Ionicons
          color={
            busy || (atFloor && !onRemove)
              ? colors.mutedForeground
              : colors.foreground
          }
          name={atFloor && onRemove ? "trash-outline" : "remove"}
          size={16}
        />
      </Pressable>

      <Text
        className="min-w-8 text-center text-sm font-semibold text-foreground"
        // A style, not `min-w-8` alone: the digits have to hold their column so
        // the row does not jump a pixel every time it crosses ten.
        style={{ minWidth: 32 }}
      >
        {quantity}
      </Text>

      <Pressable
        accessibilityLabel="Increase quantity"
        accessibilityRole="button"
        className="h-full w-9 items-center justify-center active:opacity-60"
        disabled={busy || atCeiling}
        onPress={() => {
          void Haptics.selectionAsync();
          onChange(quantity + 1);
        }}
      >
        <Ionicons
          color={busy || atCeiling ? colors.mutedForeground : colors.foreground}
          name="add"
          size={16}
        />
      </Pressable>
    </View>
  );
}

/**
 * The free-delivery progress bar from the reference cart screen.
 *
 * The number and the phrasing both come from the server — see
 * `freeDeliveryNote` — because the threshold is a commercial rule the platform
 * owner edits from a form, and a client that recomputed it would go stale the
 * moment they did.
 */
export function FreeDeliveryBar({
  note,
  progress,
}: {
  note: string;
  progress: number;
}) {
  // A resolved token, never a literal. `#0a8a4b` is the light-mode brand green
  // and would stay that exact green in dark mode, where `--primary` is `#12a95d`.
  const { colors } = useAppTheme();

  return (
    <View className="gap-2 rounded-2xl border border-primary/25 bg-brand-soft px-3.5 py-3">
      <View className="flex-row items-center gap-2">
        <Ionicons color={colors.primary} name="bicycle-outline" size={16} />
        <Text className="flex-1 text-xs font-semibold text-primary">
          {note}
        </Text>
      </View>

      {/* Hidden at 1 — a full bar under "delivery is free" is a bar with
          nothing left to say. */}
      {progress < 1 ? (
        <View className="h-1.5 overflow-hidden rounded-full bg-primary/15">
          <View
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Skeleton cards shaped like the product grid, for the first load.
 *
 * `NOTES.md` §9: loading is skeletons, not spinners. A shop is the screen where
 * that matters most — a spinner on a grid gives no sense of how much is coming.
 */
export function ProductGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <Grid gap={12} maxColumns={2} minCellWidth={148}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index}>
          <Card className="gap-2.5" padding="p-2.5">
            <Skeleton height={120} radius={IMAGE_RADIUS} />
            <Skeleton height={12} width="80%" />
            <Skeleton height={12} width="45%" />
          </Card>
        </View>
      ))}
    </Grid>
  );
}

/**
 * The store's painted header: a block of `--primary` with rounded bottom
 * corners, holding the back arrow, the title, a cart shortcut and the search
 * field.
 *
 * Not `<AppBar accent>` plus a search field underneath it, and the difference is
 * the whole point. `AppBar` paints a block and ends; a field placed after it
 * lands on the page background, which is the flat-strip-plus-toolbar look the
 * references specifically do not have. Here the field sits *inside* the colour —
 * `ebl-03` and both product boards do exactly this — and the block's rounded
 * bottom is what turns the header into an object rather than browser chrome.
 *
 * The radius and the inset handling are `AppBar`'s own (`HEADER_RADIUS`, and the
 * bar extending into the status bar rather than being pushed below it), restated
 * here because this is the one screen family that needs a taller version of the
 * same block.
 */
export function StoreHeader({
  cartCount = 0,
  onBack,
  onCart,
  onChangeSearch,
  onSubmitSearch,
  search,
  subtitle,
  title,
}: {
  cartCount?: number;
  onBack: () => void;
  onCart?: () => void;
  onChangeSearch: (next: string) => void;
  onSubmitSearch?: () => void;
  search: string;
  subtitle?: string;
  title: string;
}) {
  const insets = useSystemInsets();
  const { colors } = useAppTheme();

  return (
    <View
      // A resolved colour rather than `bg-primary`, for the reason `AppBar`
      // documents: this strip is the one surface with nothing behind it but the
      // window, so a class that fails to resolve renders it as a black bar under
      // the clock.
      style={{
        backgroundColor: colors.primary,
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
        paddingTop: insets.top,
      }}
    >
      <View className="gap-3 px-5 pb-4 pt-2">
        <View className="h-11 flex-row items-center gap-3">
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={12}
            onPress={onBack}
          >
            <Ionicons
              color={colors.primaryForeground}
              name="chevron-back"
              size={26}
            />
          </Pressable>

          <View className="flex-1">
            <Text
              className="font-semibold"
              style={{ color: colors.primaryForeground, fontSize: 17 }}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={{
                  color: colors.primaryForeground,
                  fontSize: 11,
                  opacity: 0.85,
                }}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>

          {onCart ? (
            <Pressable
              accessibilityLabel={`Cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}
              accessibilityRole="button"
              hitSlop={12}
              onPress={onCart}
            >
              <Ionicons
                color={colors.primaryForeground}
                name="cart-outline"
                size={22}
              />
              {cartCount > 0 ? (
                <View
                  className="absolute -right-2 -top-1.5 h-4 items-center justify-center rounded-full bg-card px-1"
                  style={{ minWidth: 16 }}
                >
                  <Text className="text-[10px] font-bold text-primary">
                    {cartCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>

        <StoreSearchField
          onChangeText={onChangeSearch}
          onSubmit={onSubmitSearch}
          value={search}
        />
      </View>
    </View>
  );
}
