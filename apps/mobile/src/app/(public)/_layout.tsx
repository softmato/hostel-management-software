import { Stack } from "expo-router";

/**
 * The signed-out shell.
 *
 * A plain stack rather than tabs: the bottom of the screen belongs to the Login
 * call to action until there is an account, and tabs would imply a product the
 * viewer does not have yet. Tabs appear on sign-in, per role.
 */
export default function PublicLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
