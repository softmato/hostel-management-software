import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  View,
} from "react-native";

import { CommunityPostCard } from "@/components/community-post-card";
import { AppBar } from "@/components/ui/app-bar";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { REALTIME_TOPIC } from "@/constants/topics";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useResource } from "@/hooks/use-resource";
import { readApiError } from "@/lib/api-contract";
import {
  type CommunityFeed,
  type CommunityMedia,
  type CommunityPost,
  type CommunitySpaces,
  createCommunityPost,
  getCommunityFeed,
  getCommunitySpaces,
} from "@/lib/community-api";
import {
  canPublish,
  composerTarget,
  emptyFeedMessage,
  MAX_POST_BODY,
  MAX_POST_MEDIA,
  postVisibility,
  spaceChips,
} from "@/lib/community";
import { toastError, toastSuccess } from "@/lib/toast";
import { uploadAsset } from "@/lib/uploads";

/**
 * The community feed.
 *
 * Ported from `apps/web/src/app/_components/community-page.tsx`, which is a
 * three-column layout: a spaces rail, the feed, and a sponsor rail. On a phone the
 * rail's space buttons become a horizontal chip row in the same order, the search
 * and new/top controls keep their place above the feed, and the composer sits where
 * the web's does — between the controls and the first post.
 *
 * **Not ported:** the sponsor rail, popular hostels, trending tags and the
 * guidelines card. All four are sidebar furniture served by `/community/sidebar`,
 * and none is in this milestone's checklist. Noted in `docs/MOBILE_APP_PHASES.md`
 * rather than silently dropped.
 *
 * ## Infinite scroll rather than a pager
 *
 * `useResource` holds one payload and has no notion of pages, so the feed keeps its
 * own list and appends. Page 1 replaces, later pages append, and a space/sort/search
 * change resets to page 1 — which is why the effect below keys off all three.
 *
 * ## Reading needs no account
 *
 * `GET /community` uses `loadApiPrincipal`, so this screen works signed out. What
 * changes is `spaces.viewer.canPost`: the composer is replaced by a sign-in line,
 * and reactions, comments and votes say so when tapped rather than being hidden.
 */

const SEARCH_DEBOUNCE_MS = 300;

export default function CommunityScreen() {
  const { colors } = useAppTheme();

  const spaces = useResource<CommunitySpaces>(
    useCallback(() => getCommunitySpaces(), []),
    { topics: [REALTIME_TOPIC.COMMUNITY] },
  );

  const [space, setSpace] = useState("all");
  const [sort, setSort] = useState<"new" | "top">("new");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  /*
   * Page 1 goes through `useResource` like every other GET in the app — it already
   * owns the four states, the silent refocus revalidate and the realtime topic. It
   * has no notion of pages, so later pages are fetched imperatively and kept beside
   * it in `appended`.
   *
   * Splitting it this way is also what keeps the mount effect free of a
   * synchronous `setState`: the fetch that runs on a filter change is
   * `useResource`'s, whose shape is already written around that lint rule.
   */
  const firstPage = useResource<CommunityFeed>(
    useCallback(
      () => getCommunityFeed({ page: 1, ...(query ? { q: query } : {}), sort, space }),
      [query, sort, space],
    ),
    { topics: [REALTIME_TOPIC.COMMUNITY] },
  );

  const [appended, setAppended] = useState<CommunityPost[]>([]);
  const [lastPage, setLastPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  /** `null` until a later page has been fetched; then that page's own flag. */
  const [tailHasMore, setTailHasMore] = useState<boolean | null>(null);

  const resetTail = useCallback(() => {
    setAppended([]);
    setLastPage(1);
    setTailHasMore(null);
  }, []);

  /*
   * Debounced so typing a phrase is one request rather than one per keystroke. The
   * input stays controlled by `search`; only `query` reaches the server — the web's
   * arrangement, and the reason the two pieces of state are separate.
   *
   * Both `setState` calls are inside the timeout callback, not the effect body.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      resetTail();
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [resetTail, search]);

  const posts = [...(firstPage.data?.posts ?? []), ...appended];
  const hasMore = tailHasMore ?? firstPage.data?.pagination.hasMore ?? false;

  const loadMore = useCallback(() => {
    if (loadingMore || firstPage.refreshing || !hasMore) {
      return;
    }

    setLoadingMore(true);

    const next = lastPage + 1;

    void getCommunityFeed({
      page: next,
      ...(query ? { q: query } : {}),
      sort,
      space,
    })
      .then((feed) => {
        setLastPage(next);
        setTailHasMore(feed.pagination.hasMore);
        setAppended((current) => [...current, ...feed.posts]);
      })
      // A failed "load more" keeps the feed already on screen — only a first page
      // has nothing to fall back to.
      .catch((caught: unknown) =>
        toastError("Could not load more", readApiError(caught)),
      )
      .finally(() => setLoadingMore(false));
  }, [firstPage.refreshing, hasMore, lastPage, loadingMore, query, sort, space]);

  const refresh = useCallback(() => {
    resetTail();
    firstPage.refresh();
  }, [firstPage, resetTail]);

  const viewer = spaces.data?.viewer;
  const canPost = Boolean(viewer?.canPost);
  const chips = spaceChips(spaces.data);

  const afterPost = useCallback(() => {
    resetTail();
    spaces.refresh();
    firstPage.refresh();
  }, [firstPage, resetTail, spaces]);

  const header = (
    <View className="gap-3 pb-1">
      <Input
        onChangeText={setSearch}
        placeholder="Search anything…"
        value={search}
      />

      <ScrollView
        contentContainerClassName="gap-2"
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {chips.map((chip) => {
          const active = chip.id === space;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              className={`rounded-full border px-3.5 py-2 active:opacity-70 ${
                active ? "border-primary bg-primary" : "border-border"
              }`}
              key={chip.id}
              onPress={() => {
                setSpace(chip.id);
                resetTail();
              }}
            >
              <Text
                className={`text-sm font-medium ${
                  active ? "text-primary-foreground" : "text-foreground"
                }`}
              >
                {chip.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View className="flex-row items-center gap-2">
        {(["new", "top"] as const).map((option) => {
          const active = sort === option;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              className="rounded-lg px-3 py-1.5 active:opacity-70"
              key={option}
              onPress={() => {
                setSort(option);
                resetTail();
              }}
              style={{ backgroundColor: active ? colors.brandSoft : "transparent" }}
            >
              <Text
                className={`text-sm font-semibold capitalize ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {canPost ? (
        <Composer onPosted={afterPost} spaces={spaces.data} />
      ) : spaces.data ? (
        <Card>
          <Text variant="muted">
            Sign in to post, comment and react. Reading is open to everyone.
          </Text>
        </Card>
      ) : null}
    </View>
  );

  if (firstPage.loading) {
    return (
      <Screen header={<AppBar showBack title="Community" />}>
        <LoadingState label="Loading the community" />
      </Screen>
    );
  }

  if (firstPage.error && posts.length === 0) {
    return (
      <Screen header={<AppBar showBack title="Community" />}>
        <ErrorState message={firstPage.error} onRetry={firstPage.reload} />
      </Screen>
    );
  }

  return (
    <Screen header={<AppBar showBack title="Community" />} padded={false}>
      {/*
        A `FlatList` rather than `<Screen scroll>`: this is the one screen with an
        unbounded list, so rows have to be recycled and `onEndReached` is what
        drives paging. The header travels with the list so search and the chips
        scroll away instead of eating a third of the viewport.
      */}
      <FlatList
        ListEmptyComponent={
          <EmptyState description={emptyFeedMessage(query)} title="Nothing here" />
        }
        ListFooterComponent={
          loadingMore ? (
            <View className="py-6">
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null
        }
        ListHeaderComponent={header}
        contentContainerClassName="px-5 pb-8 pt-2 gap-3"
        data={posts}
        keyExtractor={(post) => post.id}
        keyboardShouldPersistTaps="handled"
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        onRefresh={refresh}
        refreshing={firstPage.refreshing}
        renderItem={({ item }) => (
          <CommunityPostCard canPost={canPost} onChanged={afterPost} post={item} />
        )}
      />
    </Screen>
  );
}

/**
 * The composer.
 *
 * Media uploads on pick — same reasoning as the complaint form — and goes up
 * **`PUBLIC`**, matching the web's `useUploader({ accessLevel: "PUBLIC" })`. It has
 * to: a public post is read by people who are neither the asset's owner nor in the
 * author's hostel, and the file route default-denies exactly that.
 *
 * The picker is images-only. `expo-video` is not a dependency, so a video could be
 * posted and then not played by anyone on this client — and a post nobody on the
 * phone can watch is not a feature. Existing videos in the feed open in the OS
 * player.
 *
 * **There is no anonymous toggle.** `communityPostCreateSchema` is
 * `{ body, visibility, media }` — no `isAnonymous` field exists on the schema or
 * the model, so the control would be a lie.
 */
function Composer({
  onPosted,
  spaces,
}: {
  onPosted: () => void;
  spaces: CommunitySpaces | null;
}) {
  const { colors } = useAppTheme();
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<{ assetId: string; uri: string }[]>([]);
  const [membersOnly, setMembersOnly] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);

  const target = composerTarget(spaces);

  const addPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      toastError("Permission needed", "Allow photo access to attach an image.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    const picked = result.canceled ? null : result.assets[0];

    if (!picked) {
      return;
    }

    setUploading(true);

    try {
      const assetId = await uploadAsset(picked, {
        accessLevel: "PUBLIC",
        kind: "GENERIC",
        label: "Community photo",
      });

      setMedia((current) => [...current, { assetId, uri: picked.uri }]);
    } catch (caught) {
      toastError("That image did not attach", readApiError(caught));
    } finally {
      setUploading(false);
    }
  }, []);

  const publish = useCallback(async () => {
    setPosting(true);

    try {
      const attachments: CommunityMedia[] = media.map((item) => ({
        assetId: item.assetId,
        kind: "IMAGE",
      }));

      await createCommunityPost({
        body: body.trim(),
        media: attachments,
        visibility: postVisibility(spaces, membersOnly),
      });

      setBody("");
      setMedia([]);
      setMembersOnly(false);
      toastSuccess("Posted");
      onPosted();
    } catch (caught) {
      toastError("Could not post", readApiError(caught));
    } finally {
      setPosting(false);
    }
  }, [body, media, membersOnly, onPosted, spaces]);

  const ready = canPublish(body, media.length) && !uploading;

  return (
    <Card className="gap-3">
      <Input
        maxLength={MAX_POST_BODY}
        multiline
        onChangeText={setBody}
        placeholder="Share something with the community…"
        style={{ height: 76, paddingTop: 10, textAlignVertical: "top" }}
        value={body}
      />

      {media.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {media.map((item) => (
            <View className="relative" key={item.assetId}>
              <Image
                contentFit="cover"
                source={{ uri: item.uri }}
                style={{
                  backgroundColor: colors.muted,
                  borderRadius: 10,
                  height: 72,
                  width: 72,
                }}
              />
              <Pressable
                accessibilityLabel="Remove image"
                accessibilityRole="button"
                className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full"
                hitSlop={8}
                onPress={() =>
                  setMedia((current) =>
                    current.filter((entry) => entry.assetId !== item.assetId),
                  )
                }
                style={{ backgroundColor: colors.destructive }}
              >
                <Ionicons color="#ffffff" name="close" size={13} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View className="flex-row items-center gap-3 border-t border-border pt-3">
        {media.length < MAX_POST_MEDIA ? (
          <Pressable
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 active:opacity-70"
            disabled={uploading}
            onPress={() => void addPhoto()}
          >
            <Ionicons
              color={colors.mutedForeground}
              name={uploading ? "hourglass-outline" : "image-outline"}
              size={17}
            />
            <Text variant="caption">{uploading ? "Adding…" : "Photo"}</Text>
          </Pressable>
        ) : null}

        <View className="flex-1" />

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: posting, disabled: !ready }}
          className="h-9 flex-row items-center gap-1.5 rounded-lg px-4 active:opacity-80"
          disabled={!ready || posting}
          onPress={() => void publish()}
          style={{ backgroundColor: ready ? colors.primary : colors.muted }}
        >
          <Text
            className="text-sm font-semibold"
            style={{ color: ready ? colors.primaryForeground : colors.mutedForeground }}
          >
            {posting ? "Posting…" : "Post"}
          </Text>
        </Pressable>
      </View>

      <View className="flex-row items-center gap-2">
        <Ionicons
          color={colors.mutedForeground}
          name={target.canChooseAudience ? "people-outline" : "globe-outline"}
          size={14}
        />
        <Text variant="caption">{target.label}</Text>
      </View>

      {/* Only a hostel post has an audience to narrow — a public-space author has
          no smaller room, and the service forces PUBLIC for them regardless. */}
      {target.canChooseAudience ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: membersOnly }}
          className="flex-row items-center gap-2 active:opacity-70"
          onPress={() => setMembersOnly((value) => !value)}
        >
          <Ionicons
            color={membersOnly ? colors.primary : colors.mutedForeground}
            name={membersOnly ? "checkbox" : "square-outline"}
            size={19}
          />
          <Text variant="caption">Members only</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}
