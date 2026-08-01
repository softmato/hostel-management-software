import * as ImagePicker from "expo-image-picker";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  listResidentFood,
  submitFoodFeedback,
  uploadResidentFoodPhoto,
  type ResidentFoodMenu,
  type ResidentFoodPhoto,
} from "../api/client";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { screenStyles } from "./styles";

type Props = NativeStackScreenProps<RootStackParamList, "ResidentFood">;

export function ResidentFoodScreen({ route }: Props) {
  const { session } = route.params;
  const [isLoading, setIsLoading] = useState(true);
  const [menus, setMenus] = useState<ResidentFoodMenu[]>([]);
  const [photos, setPhotos] = useState<ResidentFoodPhoto[]>([]);
  const [rating, setRating] = useState("4");
  const [comment, setComment] = useState("");
  const [photoAssetId, setPhotoAssetId] = useState("");

  const loadFood = useCallback(async () => {
    setIsLoading(true);

    try {
      const data = await listResidentFood(session.accessToken);

      setMenus(data.routine?.meals ?? []);
      setPhotos(data.photos);
    } catch (error) {
      Alert.alert(
        "Could not load food",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [session.accessToken]);

  useEffect(() => {
    void loadFood();
  }, [loadFood]);

  async function handleFeedback() {
    const meal = menus[0];

    if (!meal) {
      Alert.alert("No menu", "There is no menu available for feedback.");
      return;
    }

    try {
      await submitFoodFeedback(session.accessToken, {
        comment: comment.trim() || undefined,
        date: new Date().toISOString().slice(0, 10),
        isAnonymous: false,
        mealType: meal.mealType,
        rating: Number(rating),
      });
      setComment("");
      Alert.alert("Sent", "Food feedback submitted.");
    } catch (error) {
      Alert.alert(
        "Could not send feedback",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  }

  async function pickFoodPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      quality: 0.7,
    });

    if (!result.canceled) {
      setPhotoAssetId(result.assets[0]?.uri ?? "");
    }
  }

  async function handlePhotoUpload() {
    const meal = menus[0];

    if (!meal || !photoAssetId) {
      Alert.alert("Photo required", "Choose a photo after a menu is available.");
      return;
    }

    try {
      await uploadResidentFoodPhoto(session.accessToken, {
        caption: comment.trim() || undefined,
        date: new Date().toISOString().slice(0, 10),
        mealType: meal.mealType,
        photoAssetId,
      });
      setPhotoAssetId("");
      await loadFood();
      Alert.alert("Uploaded", "Food photo uploaded.");
    } catch (error) {
      Alert.alert(
        "Could not upload photo",
        error instanceof Error ? error.message : "Please try again.",
      );
    }
  }

  return (
    <FlatList
      ListHeaderComponent={
        <View style={screenStyles.stack}>
          <View>
            <Text style={screenStyles.title}>Food</Text>
            <Text style={screenStyles.body}>Menu, photos, and feedback.</Text>
          </View>
          {isLoading ? <ActivityIndicator color="#10b981" /> : null}
          <View style={screenStyles.card}>
            <Text style={screenStyles.sectionTitle}>Feedback</Text>
            <TextInput
              keyboardType="number-pad"
              onChangeText={setRating}
              placeholder="Rating 1-5"
              style={screenStyles.input}
              value={rating}
            />
            <TextInput
              onChangeText={setComment}
              placeholder="Comment"
              style={screenStyles.input}
              value={comment}
            />
            <TouchableOpacity onPress={handleFeedback} style={screenStyles.button}>
              <Text style={screenStyles.buttonText}>Submit feedback</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={pickFoodPhoto}
              style={[screenStyles.button, screenStyles.buttonSecondary]}
            >
              <Text style={screenStyles.buttonTextSecondary}>
                {photoAssetId ? "Change food photo" : "Choose food photo"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handlePhotoUpload} style={screenStyles.button}>
              <Text style={screenStyles.buttonText}>Upload photo</Text>
            </TouchableOpacity>
          </View>
          {photos.length > 0 ? (
            <View style={screenStyles.card}>
              <Text style={screenStyles.sectionTitle}>Recent photos</Text>
              {photos.slice(0, 3).map((photo) => (
                <Text key={photo.id} style={screenStyles.body}>
                  {photo.mealType}: {photo.caption || photo.photoAssetId}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      }
      contentContainerStyle={screenStyles.scrollContent}
      data={menus}
      keyExtractor={(item) => `${item.dayOfWeek}:${item.mealType}`}
      onRefresh={loadFood}
      refreshing={isLoading}
      renderItem={({ item }) => (
        <View style={screenStyles.card}>
          <View style={screenStyles.row}>
            <Text style={screenStyles.sectionTitle}>{item.mealType}</Text>
            <Text style={screenStyles.chip}>{item.timing}</Text>
          </View>
          <Text style={screenStyles.body}>{item.items.join(", ")}</Text>
          <Text style={screenStyles.meta}>
            Every {item.dayOfWeek.charAt(0) + item.dayOfWeek.slice(1).toLowerCase()}
          </Text>
        </View>
      )}
    />
  );
}
