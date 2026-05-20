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
        <Text style={styles.heroText}>Selecione o fluxo</Text>
      </View>

      <FactoryButton
        label="Separação"
        onPress={() => router.push("/picking")}
      />
      <FactoryButton
        label="Recebimento (NF — caminhão)"
        variant="secondary"
        onPress={() => router.push("/purchase-receipt")}
      />
      <FactoryButton
        label="Armazenagem (pulmão)"
        variant="secondary"
        onPress={() => router.push("/putaway")}
      />
      <FactoryButton
        label="Transporte de carga"
        variant="success"
        onPress={() => router.push("/cargo-transport")}
      />
      <FactoryButton
        label="Abastecer estoque de giro"
        onPress={() => router.push("/stocking")}
      />

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
  apiHint: {
    marginTop: spacing.lg,
    color: theme.textMuted,
    fontSize: typography.caption,
    textAlign: "center",
  },
});
