import { useEffect, useState } from "react";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/ScreenShell";
import { FactoryButton } from "@/components/FactoryButton";
import { UserAvatarMenu } from "@/components/UserAvatarMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";
import { getApiBaseUrl } from "@/lib/api";

export default function HomeScreen() {
  const { user } = useAuth();
  const [pendingStocking, setPendingStocking] = useState(0);

  useEffect(() => {
    api
      .listPendingCargoTransfers()
      .then((d) => setPendingStocking(d.transfers.length))
      .catch(() => setPendingStocking(0));
  }, []);

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
        label="Transporte de carga"
        variant="secondary"
        onPress={() => router.push("/cargo-transport")}
      />
      <Text style={styles.hint}>
        Fila de reposição do estoque de giro — retirar do pulmão
      </Text>
      <FactoryButton
        label={
          pendingStocking > 0
            ? `Abastecer estoque (${pendingStocking})`
            : "Abastecer estoque"
        }
        onPress={() => router.push("/stocking")}
      />
      <Text style={styles.hint}>
        Depositar na gôndola (bip obrigatório)
      </Text>
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
  hint: {
    color: theme.textMuted,
    fontSize: typography.caption,
    textAlign: "center",
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
  apiHint: {
    marginTop: spacing.lg,
    color: theme.textMuted,
    fontSize: typography.caption,
    textAlign: "center",
  },
});
