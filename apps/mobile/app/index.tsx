import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/ScreenShell";
import { FactoryButton } from "@/components/FactoryButton";
import { UserAvatarMenu } from "@/components/UserAvatarMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileConfig } from "@/hooks/useMobileConfig";
import { theme, spacing, typography } from "@/lib/theme";
import { getApiBaseUrl } from "@/lib/api";

export default function HomeScreen() {
  const { user } = useAuth();
  const { data: mobileConfig } = useMobileConfig();
  const waveEnabled = mobileConfig?.waveEnabled !== false;

  return (
    <ScreenShell
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

      {waveEnabled ? (
        <FactoryButton
          label="Separação em onda"
          onPress={() => router.push("/wave-picking/index")}
        />
      ) : null}
      <FactoryButton
        label="Separação (pedido a pedido)"
        variant={waveEnabled ? "secondary" : "primary"}
        onPress={() => router.push("/picking")}
      />
      <FactoryButton
        label="Pulmão → gôndola"
        variant="success"
        onPress={() => router.push("/replenishment")}
      />
      <FactoryButton
        label="Abastecer gôndola"
        onPress={() => router.push("/stocking/index")}
      />
      <FactoryButton
        label="Consulta rápida"
        variant="secondary"
        onPress={() => router.push("/lookup")}
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
    marginTop: "auto",
    color: theme.textMuted,
    fontSize: typography.caption,
    textAlign: "center",
  },
});
