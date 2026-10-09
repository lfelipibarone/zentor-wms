import { router, type Href } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { UserAvatarMenu } from "@/components/UserAvatarMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { useHomeCounts } from "@/hooks/useHomeCounts";
import { useMyWork } from "@/hooks/useWorkShares";
import { modules, type ModuleKey } from "@/lib/modules";
import { theme, spacing, typography, radius, shadow } from "@/lib/theme";

interface Tile {
  key: ModuleKey;
  href: Href;
  count?: number;
  tag?: string | null;
  alert?: boolean;
}

export default function HomeScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const counts = useHomeCounts();
  const myWork = useMyWork();
  const shares = myWork.data?.shares ?? [];
  const waiting = shares.filter(
    (s) => s.status === "RESERVED" && s.assignedTo.id === user?.id,
  ).length;

  const firstName = user?.name.split(" ")[0] ?? "";

  const tiles: Tile[] = [
    {
      key: "picking",
      href: "/picking",
      count: counts.picking,
      tag: counts.waveOpen ? "Onda" : null,
    },
    { key: "recebimento", href: "/purchase-receipt" },
    { key: "armazenagem", href: "/putaway", count: counts.putaway },
    { key: "ressuprimento", href: "/ressuprimento", count: counts.replenishment },
    { key: "gondola", href: "/atualizar-gondola" },
    { key: "tarefas", href: "/minhas-tarefas", count: shares.length, alert: waiting > 0 },
  ];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.headerText}>
          <Text style={styles.hello} numberOfLines={1}>
            Olá{firstName ? `, ${firstName}` : ""}
          </Text>
          <Text style={styles.brand}>Help Route</Text>
        </View>
        <NotificationBell />
        <UserAvatarMenu />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.grid,
          { paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {tiles.map((t) => (
          <HomeTile key={t.key} tile={t} />
        ))}
      </ScrollView>
    </View>
  );
}

function HomeTile({ tile }: { tile: Tile }) {
  const mod = modules[tile.key];
  const count = tile.count ?? 0;
  return (
    <Pressable
      onPress={() => router.push(tile.href)}
      style={({ pressed }) => [
        styles.tile,
        tile.alert && { borderColor: mod.color, borderWidth: 2 },
        pressed && styles.tilePressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={mod.label}
    >
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, { backgroundColor: mod.color }]}>
          <Ionicons name={mod.icon} size={30} color="#fff" />
        </View>
        {count > 0 ? (
          <View style={[styles.count, { backgroundColor: mod.soft }]}>
            <Text style={[styles.countText, { color: mod.color }]}>
              {count > 99 ? "99+" : count}
            </Text>
          </View>
        ) : null}
      </View>
      <View>
        <Text style={styles.tileLabel} numberOfLines={2}>
          {mod.label}
        </Text>
        {tile.tag ? (
          <View style={[styles.tag, { backgroundColor: mod.color }]}>
            <Text style={styles.tagText}>{tile.tag}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  header: {
    backgroundColor: theme.headerBg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  headerText: { flex: 1 },
  hello: { color: theme.headerTint, fontSize: typography.title, fontWeight: "900" },
  brand: {
    color: theme.primary,
    fontSize: typography.caption,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 2,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    padding: spacing.md,
    rowGap: spacing.md,
  },
  tile: {
    width: "48%",
    aspectRatio: 1,
    backgroundColor: theme.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: theme.border,
    ...shadow,
  },
  tilePressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  tileTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  tileIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  count: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 8,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: typography.body, fontWeight: "900" },
  tileLabel: {
    fontSize: typography.body + 1,
    fontWeight: "900",
    color: theme.text,
  },
  tag: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  tagText: { color: "#fff", fontSize: typography.small, fontWeight: "900" },
});
