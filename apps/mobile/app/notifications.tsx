import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ScreenShell } from "@/components/ScreenShell";
import { Card, EmptyState, Loading } from "@/components/ui";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationDto,
} from "@/lib/notifications-api";
import { showErrorAlert } from "@/lib/app-alert";
import { openWorkShareRoute } from "@/lib/work-route";
import { theme, spacing, typography, radius } from "@/lib/theme";

export default function NotificationsScreen() {
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchNotifications(1);
      setItems(data.notifications);
    } catch (e) {
      setItems([]);
      showErrorAlert(
        e instanceof Error ? e.message : "Erro ao carregar notificações",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markAll = async () => {
    try {
      await markAllNotificationsRead();
      await load();
    } catch (e) {
      showErrorAlert(e instanceof Error ? e.message : "Erro ao marcar como lidas");
    }
  };

  const hasUnread = items.some((n) => !n.readAt);

  return (
    <ScreenShell
      title="Notificações"
      style={styles.shell}
      headerRight={
        hasUnread ? (
          <Pressable
            onPress={markAll}
            style={styles.headerAction}
            hitSlop={8}
            accessibilityLabel="Marcar todas como lidas"
          >
            <Ionicons name="checkmark-done" size={22} color={theme.headerTint} />
          </Pressable>
        ) : null
      }
    >
      {loading ? (
        <Loading />
      ) : (
        <FlatList
          style={styles.flex}
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.list}
          refreshing={false}
          onRefresh={load}
          ListEmptyComponent={
            <EmptyState icon="notifications-off-outline" title="Nenhuma notificação" />
          }
          renderItem={({ item }) => (
            <Card
              accent={item.readAt ? undefined : theme.primary}
              onPress={
                item.readAt && !item.data?.route
                  ? undefined
                  : async () => {
                      const route = item.data?.route;
                      if (route) openWorkShareRoute(route);
                      if (item.readAt) return;
                      try {
                        await markNotificationRead(item.id);
                        if (!route) await load();
                      } catch (e) {
                        showErrorAlert(
                          e instanceof Error ? e.message : "Erro ao marcar como lida",
                        );
                      }
                    }
              }
            >
              <View style={styles.row}>
                <Text style={[styles.itemTitle, item.readAt && styles.read]} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.itemDate}>
                  {new Date(item.createdAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
              <Text style={styles.itemBody}>{item.body}</Text>
            </Card>
          )}
        />
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shell: { paddingBottom: 0 },
  flex: { flex: 1 },
  list: { paddingBottom: spacing.xl * 2, gap: spacing.sm, flexGrow: 1 },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  itemTitle: { flex: 1, fontWeight: "900", color: theme.text, fontSize: typography.body },
  read: { color: theme.textMuted },
  itemBody: { color: theme.textMuted, marginTop: 4, fontWeight: "600" },
  itemDate: { fontSize: typography.small, color: theme.textSoft, fontWeight: "700" },
});
