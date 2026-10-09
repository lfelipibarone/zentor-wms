import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { fetchNotifications } from "@/lib/notifications-api";
import { theme } from "@/lib/theme";

export function NotificationBell({ color = theme.headerTint }: { color?: string }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchNotifications(1);
      setUnread(data.unreadCount);
    } catch {
      setUnread(0);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <Pressable
      onPress={() => router.push("/notifications")}
      style={styles.bell}
      accessibilityLabel="Notificações"
    >
      <Ionicons name="notifications-outline" size={26} color={color} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 9 ? "9+" : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: { padding: 8, position: "relative" },
  badge: {
    position: "absolute",
    top: 4,
    right: 3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.danger,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 2,
    borderColor: theme.headerBg,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },
});
