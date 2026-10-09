import { useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { Badge, Card, EmptyState, Loading, ProgressBar } from "@/components/ui";
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

  return (
    <ScreenShell module="tarefas" title="Minhas tarefas" style={styles.shell}>
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          style={styles.flex}
          data={shares}
          keyExtractor={(s) => s.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState icon="people-outline" title="Nenhuma tarefa" />}
          renderItem={({ item }) => {
            const declinedByOther = item.status === "DECLINED" && item.assignedTo.id !== user?.id;
            const accent = declinedByOther
              ? theme.danger
              : item.status === "STARTED"
                ? theme.primary
                : theme.warning;
            const statusTone =
              item.status === "STARTED" ? "primary" : declinedByOther ? "danger" : "warning";
            return (
              <Card
                accent={accent}
                onPress={declinedByOther ? undefined : () => openWorkShareRoute(item.route)}
                style={styles.card}
              >
                <View style={styles.row}>
                  <Badge label={item.kindLabel} tone="info" />
                  <Badge label={WORK_STATUS_LABEL[item.status]} tone={statusTone} />
                  <View style={styles.flex} />
                  {item.status === "STARTED" ? <WorkTimer share={item} /> : null}
                </View>
                <Text style={styles.title}>{item.title}</Text>
                {item.subtitle ? <Text style={styles.meta}>{item.subtitle}</Text> : null}
                <View style={styles.progressRow}>
                  <View style={styles.flex}>
                    <ProgressBar value={item.itemsDone} total={item.itemsTotal} color={accent} />
                  </View>
                  <Text style={styles.progressText}>
                    {item.itemsDone}/{item.itemsTotal}
                  </Text>
                  {item.shareCount > 1 ? (
                    <Badge label={`Parte ${item.shareIndex}/${item.shareCount}`} />
                  ) : null}
                </View>

                {declinedByOther ? (
                  <>
                    <Text style={styles.declined}>Recusada por {item.assignedTo.name}</Text>
                    <View style={styles.actions}>
                      <FactoryButton
                        label="Passar"
                        icon="swap-horizontal"
                        size="md"
                        style={styles.flex}
                        onPress={() => setReassigning(item)}
                      />
                      <FactoryButton
                        label="Assumir"
                        icon="hand-left"
                        size="md"
                        variant="secondary"
                        style={styles.flex}
                        loading={reassign.isPending && reassign.variables?.shareId === item.id}
                        onPress={() =>
                          user &&
                          run(() => reassign.mutateAsync({ shareId: item.id, userId: user.id }))
                        }
                      />
                    </View>
                  </>
                ) : item.status === "RESERVED" ? (
                  <>
                    {item.assignedBy && item.assignedBy.id !== user?.id ? (
                      <Text style={styles.meta}>De {item.assignedBy.name}</Text>
                    ) : null}
                    <View style={styles.actions}>
                      <FactoryButton
                        label="Iniciar"
                        icon="play"
                        size="md"
                        variant="success"
                        style={styles.flex}
                        loading={start.isPending && start.variables === item.id}
                        onPress={() =>
                          run(async () => {
                            await start.mutateAsync(item.id);
                            openWorkShareRoute(item.route);
                          })
                        }
                      />
                      {item.assignedBy && item.assignedBy.id !== user?.id ? (
                        <FactoryButton
                          label="Recusar"
                          icon="close"
                          size="md"
                          variant="secondary"
                          style={styles.flex}
                          loading={decline.isPending && decline.variables === item.id}
                          onPress={() => run(() => decline.mutateAsync(item.id))}
                        />
                      ) : null}
                    </View>
                  </>
                ) : null}
              </Card>
            );
          }}
        />
      )}

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
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shell: { paddingBottom: 0 },
  flex: { flex: 1 },
  list: { paddingBottom: spacing.xl * 2, gap: spacing.sm, flexGrow: 1 },
  card: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: typography.subtitle, fontWeight: "900", color: theme.text },
  meta: { color: theme.textMuted, fontWeight: "600" },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  progressText: { fontWeight: "900", color: theme.text },
  declined: { color: theme.danger, fontWeight: "800" },
  actions: { flexDirection: "row", gap: spacing.sm },
});
