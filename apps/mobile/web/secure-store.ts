/**
 * `expo-secure-store` for the installable web app. A browser has no keychain,
 * so `lib/session.ts` keeps the tokens in `localStorage`, as web clients do.
 */
export async function getItemAsync(key: string) {
  return localStorage.getItem(key);
}

export async function setItemAsync(key: string, value: string) {
  localStorage.setItem(key, value);
}

export async function deleteItemAsync(key: string) {
  localStorage.removeItem(key);
}
