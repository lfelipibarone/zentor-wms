import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/ScreenShell";
import { FactoryButton } from "@/components/FactoryButton";
import { UserAvatarMenu } from "@/components/UserAvatarMenu";
import { NotificationBell } from "@/components/NotificationBell";
import { useAuth } from "@/contexts/AuthContext";
import { useMyWork } from "@/hooks/useWorkShares";
import { theme, spacing, typography } from "@/lib/theme";
import { getApiBaseUrl } from "@/lib/api";

export default function HomeScreen() {
  const { user } = useAuth();
  const myWork = useMyWork();
  const shares = myWork.data?.shares ?? [];
  const waiting = shares.filter((s) => s.status === "RESERVED" && s.assignedTo.id === user?.id).length;
  const running = shares.filter((s) => s.status === "STARTED").length;
  const declined = shares.filter((s) => s.status === "DECLINED").length;

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

      {shares.length > 0 ? (
        <Pressable style={styles.tasks} onPress={() => router.push("/minhas-tarefas")}>
          <Text style={styles.tasksTitle}>Minhas tarefas ({shares.length})</Text>
          <Text style={styles.tasksMeta}>
            {[
              waiting > 0 ? `${waiting} para iniciar` : null,
              running > 0 ? `${running} em andamento` : null,
              declined > 0 ? `${declined} recusada(s)` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </Pressable>
      ) : null}

      <FactoryButton label="Picking" onPress={() => router.push("/picking")} />

      <FactoryButton
        label="Recebimento (conferência NF)"
        variant="secondary"
        onPress={() => router.push("/purchase-receipt")}
      />

      <FactoryButton
        label="Atualizar gôndola"
        variant="secondary"
        onPress={() => router.push("/atualizar-gondola")}
      />
      <Text style={styles.putawayHint}>
        Leia o QR do produto ou a gôndola e informe a %
      </Text>

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
  tasks: {
    backgroundColor: "#FFFBEB",
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: theme.warning,
    marginBottom: spacing.sm,
  },
  tasksTitle: { fontSize: typography.body, fontWeight: "900", color: theme.text },
  tasksMeta: { color: theme.textMuted, fontWeight: "700", marginTop: 2 },
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
