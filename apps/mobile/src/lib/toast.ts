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

/**
 * An urgent live event — an SOS, a HIGH/URGENT announcement.
 *
 * Rendered with the error style deliberately: `react-native-toast-message`
 * ships success/error/info and nothing between, and of the three only error
 * reads as "stop and look". Naming it for what it *is* keeps call sites honest
 * about that being a presentation choice rather than a claim that something
 * failed. It also stays up roughly twice as long, because these arrive
 * unprompted and the reader was not waiting for them.
 */
export function toastUrgent(title: string, description?: string) {
  Toast.show({ text1: title, text2: description, type: "error", visibilityTime: 8000 });
}
