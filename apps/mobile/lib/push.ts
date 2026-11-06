import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { registerPushDevice } from "./notifications-api";

type NotificationsModule = typeof import("expo-notifications");

/** Remote push is unavailable in Expo Go since SDK 53. */
function isRemotePushSupported(): boolean {
  if (!Device.isDevice) return false;
  if (Constants.appOwnership === "expo") return false;
  if (Constants.executionEnvironment === "storeClient") return false;
  return true;
}

/**
 * APK/dev client antigo pode não ter ExpoApplication / expo-notifications nativo.
 * Falha de módulo nativo vira null — o app segue sem push.
 */
async function loadNotifications(): Promise<NotificationsModule | null> {
  try {
    return await import("expo-notifications");
  } catch {
    return null;
  }
}

export async function setupPushNotifications(): Promise<void> {
  if (!isRemotePushSupported()) return;

  const Notifications = await loadNotifications();
  if (!Notifications) return;

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
  const Notifications = await loadNotifications();
  if (!Notifications) return () => {};
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
