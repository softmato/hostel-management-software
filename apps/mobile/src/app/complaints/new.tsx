import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";

import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Screen } from "@/components/ui/screen";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/hooks/use-app-theme";
import { readApiError } from "@/lib/api-contract";
import {
  COMPLAINT_CATEGORY_OPTIONS,
  type ComplaintDraft,
  type ComplaintErrors,
  hasComplaintErrors,
  MAX_COMPLAINT_ATTACHMENTS,
  validateComplaint,
} from "@/lib/complaints";
import {
  type ComplaintCategory,
  createResidentComplaint,
} from "@/lib/complaints-api";
import { toastError, toastSuccess } from "@/lib/toast";
import { uploadAsset } from "@/lib/uploads";

/**
 * Raising one.
 *
 * ## Photos upload on pick, not on submit
 *
 * Each picked image runs the full presign → PUT → complete pipeline immediately
 * and the screen keeps the returned `assetId`. Two reasons: an asset that never
 * *completes* is a reservation the hostel cannot open, so the completion has to
 * be visible before the complaint references it; and uploading four photos
 * inside the submit handler makes the one tap that matters take thirty seconds
 * with nothing to show for it.
 *
 * Progress is not drawn here — `uploadAsset` registers with the queue that the
 * always-mounted `<UploadToaster />` renders. The thumbnail below is the *local*
 * file, which needs no auth and no round trip.
 *
 * ## Anonymous hides the name from staff, not from the record
 *
 * `isAnonymous` nulls `residentId` in the *admin's* serialization only, and
 * `auditComplaintAction` still writes `actorId` on creation. The complaint is
 * also still the resident's own in their own list. The toggle's caption says all
 * three, rather than implying untraceability the server does not provide.
 */

type PickedAttachment = {
  assetId: string;
  /** The on-device file, for the thumbnail. */
  uri: string;
};

export default function NewComplaintScreen() {
  const { colors } = useAppTheme();
  const [category, setCategory] = useState<ComplaintCategory>("MAINTENANCE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<ComplaintErrors>({});

  const addPhoto = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      toastError("Permission needed", "Allow photo access to attach evidence.");
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
      /*
       * `GENERIC`, not `PAYMENT_PROOF`: the presign route refuses a financial
       * asset it cannot tenant-scope, and a photo of a broken tap is not money
       * evidence.
       */
      const assetId = await uploadAsset(picked, {
        kind: "GENERIC",
        label: "Complaint photo",
      });

      setAttachments((current) => [...current, { assetId, uri: picked.uri }]);
    } catch (caught) {
      toastError("That photo did not attach", readApiError(caught));
    } finally {
      setUploading(false);
    }
  }, []);

  const remove = useCallback((assetId: string) => {
    // Local only. The `FileAsset` stays uploaded and simply goes unreferenced —
    // there is no resident-facing delete route, and inventing one by leaving the
    // id out is the honest half of the job.
    setAttachments((current) => current.filter((item) => item.assetId !== assetId));
  }, []);

  const submit = useCallback(async () => {
    const draft: ComplaintDraft = {
      attachmentCount: attachments.length,
      description,
      title,
    };
    const found = validateComplaint(draft);

    setErrors(found);

    if (hasComplaintErrors(found)) {
      return;
    }

    setSubmitting(true);

    try {
      await createResidentComplaint({
        attachmentAssetIds: attachments.map((item) => item.assetId),
        category,
        description: description.trim(),
        isAnonymous,
        title: title.trim(),
      });

      toastSuccess("Complaint raised", "Your hostel has been notified.");
      // Back to the list rather than into the new complaint: the list is where
      // the resident came from and it now shows the row they just created.
      router.back();
    } catch (caught) {
      toastError("Could not raise that complaint", readApiError(caught));
    } finally {
      setSubmitting(false);
    }
  }, [attachments, category, description, isAnonymous, title]);

  const full = attachments.length >= MAX_COMPLAINT_ATTACHMENTS;

  return (
    <Screen
      footer={
        <Button
          label="Submit complaint"
          loading={submitting}
          onPress={() => void submit()}
        />
      }
      header={<AppBar showBack title="Raise a complaint" />}
      scroll
    >
      <View className="gap-4 pt-1">
        <Select
          hint="Picks who at the hostel sees it first."
          label="What is this about?"
          onChange={setCategory}
          options={COMPLAINT_CATEGORY_OPTIONS}
          value={category}
        />

        <Input
          error={errors.title}
          label="Title"
          maxLength={160}
          onChangeText={setTitle}
          placeholder="Running tap in the shared bathroom"
          value={title}
        />

        <Input
          error={errors.description}
          label="What happened?"
          maxLength={4000}
          multiline
          numberOfLines={6}
          onChangeText={setDescription}
          placeholder="When it started, which room, what you have already tried."
          style={{ height: 132, paddingTop: 12, textAlignVertical: "top" }}
          value={description}
        />

        <View className="gap-2">
          <Text variant="label">Photos</Text>
          <Text variant="caption">
            Up to {MAX_COMPLAINT_ATTACHMENTS}. A photo settles an argument about
            whether something is broken.
          </Text>

          <View className="flex-row flex-wrap gap-2 pt-1">
            {attachments.map((attachment) => (
              <View className="relative" key={attachment.assetId}>
                <Image
                  contentFit="cover"
                  source={{ uri: attachment.uri }}
                  style={{
                    backgroundColor: colors.muted,
                    borderRadius: 12,
                    height: 88,
                    width: 88,
                  }}
                />

                <Pressable
                  accessibilityLabel="Remove photo"
                  accessibilityRole="button"
                  className="absolute -right-1.5 -top-1.5 h-6 w-6 items-center justify-center rounded-full"
                  hitSlop={8}
                  onPress={() => remove(attachment.assetId)}
                  style={{ backgroundColor: colors.destructive }}
                >
                  <Ionicons color="#ffffff" name="close" size={14} />
                </Pressable>
              </View>
            ))}

            {full ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: uploading }}
                className="h-[88px] w-[88px] items-center justify-center gap-1 rounded-xl border border-dashed border-border active:opacity-70"
                disabled={uploading}
                onPress={() => void addPhoto()}
              >
                <Ionicons
                  color={colors.mutedForeground}
                  name={uploading ? "hourglass-outline" : "camera-outline"}
                  size={20}
                />
                <Text variant="caption">{uploading ? "Adding" : "Add"}</Text>
              </Pressable>
            )}
          </View>

          {errors.attachmentCount ? (
            <Text className="text-destructive" variant="caption">
              {errors.attachmentCount}
            </Text>
          ) : null}
        </View>

        <Card>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: isAnonymous }}
            className="flex-row items-center gap-3 active:opacity-70"
            onPress={() => setIsAnonymous((value) => !value)}
          >
            <Ionicons
              color={isAnonymous ? colors.primary : colors.mutedForeground}
              name={isAnonymous ? "checkbox" : "square-outline"}
              size={22}
            />

            <View className="flex-1">
              <Text variant="label">Raise this anonymously</Text>
              <Text variant="caption">
                Hostel staff see the complaint without your name. It still appears
                in your own list, and it is still recorded against your account.
              </Text>
            </View>
          </Pressable>
        </Card>
      </View>
    </Screen>
  );
}
