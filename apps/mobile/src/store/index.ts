import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  combineReducers,
  configureStore,
  type UnknownAction,
} from "@reduxjs/toolkit";
import {
  FLUSH,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  REHYDRATE,
  createMigrate,
  createTransform,
  persistReducer,
  persistStore,
} from "redux-persist";

import authReducer, { type AuthState } from "@/store/slices/authSlice";
import uiReducer from "@/store/slices/uiSlice";

/**
 * Changing a slice's `initialState` does **not** change what an existing
 * install sees: rehydration writes the stored value straight over it. So a new
 * default only reaches a phone that already has the app if a migration puts it
 * there.
 *
 * This is easy to miss because it works perfectly on a fresh install and not at
 * all on the device you have been testing with all day.
 *
 * Bump `PERSIST_VERSION` and add an entry here whenever a persisted default
 * changes meaning.
 */
const PERSIST_VERSION = 2;

const migrations = {
  /** Theme default moved from "system" to "light" — see uiSlice. */
  2: (state: unknown) => {
    const previous = state as { ui?: { themePreference?: string } } | undefined;

    if (!previous) return previous;

    return { ...previous, ui: { ...previous.ui, themePreference: "light" } };
  },
};

/**
 * Two auth fields must never survive a relaunch.
 *
 * `accessToken` because its durable home is SecureStore — writing it to
 * AsyncStorage too would put a bearer token in plaintext on disk, which is the
 * whole reason SecureStore is there.
 *
 * `isReady` because it gates the splash. Rehydrating it as `true` would skip
 * the boot gate entirely, and the app would route off a cached account without
 * ever checking whether the tokens behind it still exist.
 */
const volatileAuthFields = createTransform<AuthState, AuthState>(
  (state) => ({ ...state, accessToken: null, isReady: false }),
  (state) => ({ ...state, accessToken: null, isReady: false }),
  { whitelist: ["auth"] },
);

const combined = combineReducers({
  auth: authReducer,
  ui: uiReducer,
});

/**
 * Wipes every slice back to its initial state.
 *
 * Dispatched on logout and on a failed refresh. Phones get shared — a resident
 * signs out, a cook signs in — so leaving one account's cached dashboard in
 * memory is a data leak, not just a stale render. Pair with `persistor.purge()`
 * to clear what is already on disk.
 */
export const RESET_STORE = "store/reset" as const;
export const resetStore = () => ({ type: RESET_STORE });

type AppState = ReturnType<typeof combined>;

const rootReducer = (state: AppState | undefined, action: UnknownAction): AppState => {
  if (action.type === RESET_STORE) {
    // Returning undefined state makes every reducer fall back to its initial
    // value; `_persist` is re-attached by persistReducer.
    return combined(undefined, action);
  }

  return combined(state, action);
};

const persistedReducer = persistReducer<AppState>(
  {
    key: "root",
    storage: AsyncStorage,
    /*
     * `auth` is persisted for one reason: the boot gate needs the cached
     * account to choose a route before the first frame. `accessToken` and
     * `isReady` are stripped below — the token's durable home is SecureStore,
     * and `isReady` must start false on every launch or the gate is skipped.
     */
    transforms: [volatileAuthFields],
    // redux-persist types migrations against its own `PersistedState`, which is
    // looser than this root state; the cast is at the boundary, not inside.
    migrate: createMigrate(migrations as Parameters<typeof createMigrate>[0]),
    version: PERSIST_VERSION,
    whitelist: ["auth", "ui"],
  },
  rootReducer,
);

export const store = configureStore({
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, PAUSE, PERSIST, PURGE, REGISTER, REHYDRATE],
      },
    }),
  reducer: persistedReducer,
});

export const persistor = persistStore(store);

export type AppDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
