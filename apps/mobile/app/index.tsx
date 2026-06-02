import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/ScreenShell";
import { FactoryButton } from "@/components/FactoryButton";
import { UserAvatarMenu } from "@/components/UserAvatarMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { theme, spacing, typography } from "@/lib/theme";
import { getApiBaseUrl } from "@/lib/api";

export default function HomeScreen() {
  const { user } = useAuth();

  return (
    <ScreenShell
      scroll
      title="Help Route"
      subtitle={user ? `${user.name} · ${user.role}` : "Operações de galpão"}
    >
      <View style={styles.topBar}>
        <NotificationBell />
        <UserAvatarMenu />
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroText}>Operações</Text>
      </View>

      <FactoryButton label="Picking" onPress={() => router.push("/picking")} />

      <FactoryButton
        label="Correção"
        variant="secondary"
        onPress={() => router.push("/correcao")}
      />

      <FactoryButton
        label="Ressuprimento"
        onPress={() => router.push("/ressuprimento")}
      />

      <FactoryButton
        label="Armazenagem pulmão"
        variant="secondary"
        onPress={() => router.push("/putaway")}
      />
      <Text style={styles.putawayHint}>
        NFs conferidas no recebimento — endereçamento no pulmão
      </Text>

      <Text style={styles.apiHint}>API: {getApiBaseUrl()}</Text>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: -spacing.sm,
    marginBottom: spacing.xs,
  },
  hero: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: theme.primary,
  },
  heroText: {
    fontSize: typography.hero,
    fontWeight: "900",
    color: theme.primary,
    textAlign: "center",
  },
  putawayHint: {
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
    color: theme.textMuted,
    fontSize: typography.caption,
    textAlign: "center",
    fontWeight: "600",
  },
  apiHint: {
    marginTop: spacing.lg,
    color: theme.textMuted,
    fontSize: typography.caption,
    textAlign: "center",
  },
});
