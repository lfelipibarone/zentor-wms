import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { ColleaguePickerModal } from "@/components/SplitWorkModal";
import { WORK_STATUS_LABEL, WorkTimer } from "@/components/WorkTimer";
import { useAuth } from "@/contexts/AuthContext";
import { useMyWork, useWorkShareActions } from "@/hooks/useWorkShares";
import { showErrorAlert } from "@/lib/app-alert";
import type { WorkShareSummary } from "@/lib/api";
import { openWorkShareRoute } from "@/lib/work-route";
import { theme, spacing, typography } from "@/lib/theme";

export default function MyTasksScreen() {
  const { user } = useAuth();
  const { data, isLoading, refetch, isRefetching } = useMyWork();
  const { start, decline, reassign } = useWorkShareActions();
  const [reassigning, setReassigning] = useState<WorkShareSummary | null>(null);
  const shares = data?.shares ?? [];

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      showErrorAlert(e instanceof Error ? e.message : "Não foi possível concluir");
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={shares}
        keyExtractor={(s) => s.id}
        refreshing={isRefetching}
        onRefresh={refetch}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>Nenhuma tarefa reservada para você.</Text>
        }
        renderItem={({ item }) => {
          const declinedByOther = item.status === "DECLINED" && item.assignedTo.id !== user?.id;
          return (
            <Pressable
              style={[
                styles.card,
                item.status === "STARTED" && styles.cardRunning,
                declinedByOther && styles.cardDeclined,
              ]}
              disabled={declinedByOther}
              onPress={() => openWorkShareRoute(item.route)}
            >
              <View style={styles.row}>
                <Text style={styles.kind}>{item.kindLabel}</Text>
                {item.status === "STARTED" ? <WorkTimer share={item} /> : null}
              </View>
              <Text style={styles.title}>{item.title}</Text>
              {item.subtitle ? <Text style={styles.meta}>{item.subtitle}</Text> : null}
              <Text style={styles.meta}>
                {item.shareCount > 1 ? `Parte ${item.shareIndex} de ${item.shareCount} · ` : ""}
                {item.itemsDone}/{item.itemsTotal} itens · {WORK_STATUS_LABEL[item.status]}
              </Text>

              {declinedByOther ? (
                <>
                  <Text style={styles.declined}>Recusada por {item.assignedTo.name}</Text>
                  <FactoryButton
                    label="Passar para outro colega"
                    onPress={() => setReassigning(item)}
                    style={styles.btn}
                  />
                  <FactoryButton
                    label="Assumir eu mesmo"
                    variant="secondary"
                    loading={reassign.isPending && reassign.variables?.shareId === item.id}
                    onPress={() =>
                      user && run(() => reassign.mutateAsync({ shareId: item.id, userId: user.id }))
                    }
                    style={styles.btn}
                  />
                </>
              ) : item.status === "RESERVED" ? (
                <>
                  {item.assignedBy && item.assignedBy.id !== user?.id ? (
                    <Text style={styles.meta}>Enviada por {item.assignedBy.name}</Text>
                  ) : null}
                  <FactoryButton
                    label="Iniciar"
                    variant="success"
                    loading={start.isPending && start.variables === item.id}
                    onPress={() =>
                      run(async () => {
                        await start.mutateAsync(item.id);
                        openWorkShareRoute(item.route);
                      })
                    }
                    style={styles.btn}
                  />
                  {item.assignedBy && item.assignedBy.id !== user?.id ? (
                    <FactoryButton
                      label="Recusar"
                      variant="secondary"
                      loading={decline.isPending && decline.variables === item.id}
                      onPress={() => run(() => decline.mutateAsync(item.id))}
                      style={styles.btn}
                    />
                  ) : null}
                </>
              ) : (
                <Text style={styles.tap}>TOQUE PARA CONTINUAR</Text>
              )}
            </Pressable>
          );
        }}
      />

      <ColleaguePickerModal
        visible={Boolean(reassigning)}
        title="Passar a parte para"
        excludeIds={reassigning ? [reassigning.assignedTo.id] : []}
        loading={reassign.isPending}
        onCancel={() => setReassigning(null)}
        onPick={(userId) => {
          const share = reassigning;
          if (!share) return;
          void run(async () => {
            await reassign.mutateAsync({ shareId: share.id, userId });
            setReassigning(null);
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  empty: { textAlign: "center", color: theme.textMuted, marginTop: spacing.lg },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: theme.warning,
  },
  cardRunning: { borderColor: theme.primary },
  cardDeclined: { borderColor: theme.danger },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kind: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.primary,
    textTransform: "uppercase",
  },
  title: { fontSize: typography.body, fontWeight: "900", color: theme.text, marginTop: 2 },
  meta: { color: theme.textMuted, fontWeight: "600", marginTop: 2 },
  declined: { color: theme.danger, fontWeight: "800", marginTop: spacing.xs },
  btn: { marginTop: spacing.sm, marginBottom: 0 },
  tap: {
    marginTop: spacing.sm,
    textAlign: "center",
    fontWeight: "800",
    color: theme.primary,
    fontSize: typography.caption,
  },
});
