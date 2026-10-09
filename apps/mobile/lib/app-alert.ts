import { Alert } from "react-native";

export function showErrorAlert(message: string, title = "Erro") {
  Alert.alert(title, message);
}

type ToastListener = (message: string) => void;
const toastListeners = new Set<ToastListener>();

export function subscribeToast(listener: ToastListener) {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}

/** Confirmação rápida que some sozinha — não interrompe o operador */
export function showToast(message: string) {
  toastListeners.forEach((l) => l(message));
}
