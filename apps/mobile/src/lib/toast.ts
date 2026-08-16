import Toast from "react-native-toast-message";

/**
 * One place that decides how feedback looks, so a success in Payments and a
 * success in Complaints are not subtly different.
 */

export function toastSuccess(title: string, description?: string) {
  Toast.show({ text1: title, text2: description, type: "success" });
}

export function toastError(title: string, description?: string) {
  Toast.show({ text1: title, text2: description, type: "error" });
}

export function toastInfo(title: string, description?: string) {
  Toast.show({ text1: title, text2: description, type: "info" });
}
