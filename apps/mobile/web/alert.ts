import { Alert } from "react-native";

import { openConfirm } from "@/lib/confirm";

/**
 * react-native-web's `Alert.alert` does nothing, so in the web build every
 * question the app asks with it would vanish along with its button's action.
 * There it opens our own confirm modal instead — the one `openConfirm` shows on
 * the phone. Loaded once, for its side effect, by `web/entry.ts`.
 *
 * One action and an optional cancel is what the app asks; a third button, if
 * one ever appears, is dropped rather than guessed at.
 */
Alert.alert = (title, message, buttons) => {
  const cancel = buttons?.find((button) => button.style === "cancel");
  const action = buttons?.filter((button) => button !== cancel).at(-1) ?? cancel;

  openConfirm({
    cancelLabel: cancel && cancel !== action ? (cancel.text ?? "Cancel") : null,
    confirmLabel: action?.text ?? "OK",
    destructive: action?.style === "destructive",
    message,
    onConfirm: () => action?.onPress?.(),
    title,
  });
};
