import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { registerPushDevice } from "./notifications-api";

/** Remote push is unavailable in Expo Go since SDK 53. */
function isRemotePushSupported(): boolean {
  if (!Device.isDevice) return false;
  return (
    Constants.appOwnership !== "expo" &&
    Constants.executionEnvironment !== "storeClient"
  );
}

export async function setupPushNotifications(): Promise<void> {
  if (!isRemotePushSupported()) return;

  const Notifications = await import("expo-notifications");

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Help Route WMS",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  await registerPushDevice(tokenData.data);
}

type PushRoute = { pathname: string; params: Record<string, string> };

/** Ao tocar numa notificação com rota (ex.: parte de tarefa), abre a tela. */
export async function listenForPushTaps(
  onRoute: (route: PushRoute) => void,
): Promise<() => void> {
  if (!isRemotePushSupported()) return () => {};
  const Notifications = await import("expo-notifications");
  const handle = (data: unknown) => {
    const route = (data as { route?: PushRoute } | null)?.route;
    if (route?.pathname) onRoute({ pathname: route.pathname, params: route.params ?? {} });
  };
  const last = await Notifications.getLastNotificationResponseAsync();
  if (last) handle(last.notification.request.content.data);
  const sub = Notifications.addNotificationResponseReceivedListener((response) =>
    handle(response.notification.request.content.data),
  );
  return () => sub.remove();
}
