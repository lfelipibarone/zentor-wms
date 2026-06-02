import { Alert } from "react-native";

export function showErrorAlert(message: string, title = "Erro") {
  Alert.alert(title, message);
}

export function showInfoAlert(message: string, title = "Aviso") {
  Alert.alert(title, message);
}
