import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkShareActions } from "@/hooks/useWorkShares";
import { showErrorAlert } from "@/lib/app-alert";
import type { WorkRefDto, WorkShareStatus, WorkShareSummary } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec == null || totalSec < 0) return "--:--";
  const s = Math.floor(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export const WORK_STATUS_LABEL: Record<WorkShareStatus, string> = {
  RESERVED: "Aguardando início",
  STARTED: "Em andamento",
  FINISHED: "Concluída",
  DECLINED: "Recusada",
  CANCELLED: "Cancelada",
};

/** Cronômetro ao vivo a partir do tempo calculado pelo servidor. */
export function WorkTimer({
  share,
  style,
}: {
  share: Pick<WorkShareSummary, "status" | "elapsedSec">;
  style?: TextStyle;
}) {
  const running = share.status === "STARTED";
  const receivedAt = useRef(Date.now());
  const [, setTick] = useState(0);

  useEffect(() => {
    receivedAt.current = Date.now();
  }, [share.elapsedSec]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const base = share.elapsedSec;
  const value =
    base == null ? null : running ? base + (Date.now() - receivedAt.current) / 1000 : base;
  return <Text style={[styles.timer, style]}>{formatDuration(value)}</Text>;
}

/** Cartão "Sua parte k de N" com Iniciar/Recusar, cronômetro e as partes dos colegas. */
export function WorkShareCard({ work }: { work: WorkRefDto | null | undefined }) {
  const { user } = useAuth();
  const { start, decline } = useWorkShareActions();
  if (!work || work.shares.length === 0) return null;

  const mine = work.mine;
  const others = work.shares.filter((s) => s.id !== mine?.id);
  const multi = (mine?.shareCount ?? work.shares[0]?.shareCount ?? 1) > 1;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      showErrorAlert(e instanceof Error ? e.message : "Não foi possível concluir");
    }
  };

  return (
    <View style={styles.wrap}>
      {mine ? (
        <View style={[styles.card, mine.status === "STARTED" && styles.cardRunning]}>
          <View style={styles.row}>
            <Text style={styles.heading}>
              {multi ? `Sua parte ${mine.shareIndex} de ${mine.shareCount}` : "Sua tarefa"}
            </Text>
            {mine.status === "STARTED" || mine.status === "FINISHED" ? (
              <WorkTimer share={mine} />
            ) : null}
          </View>
          <Text style={styles.meta}>
            {mine.status === "RESERVED"
              ? `${mine.itemsTotal} itens · ${mine.unitsTotal} un.`
              : `${mine.itemsDone}/${mine.itemsTotal} itens · ${mine.unitsDone}/${mine.unitsTotal} un.`}
            {" · "}
            {WORK_STATUS_LABEL[mine.status]}
          </Text>
          {mine.assignedBy && mine.assignedBy.id !== user?.id ? (
            <Text style={styles.meta}>Enviada por {mine.assignedBy.name}</Text>
          ) : null}
          {mine.status === "RESERVED" ? (
            <>
              <FactoryButton
                label="Iniciar"
                variant="success"
                loading={start.isPending}
                disabled={decline.isPending}
                onPress={() => run(() => start.mutateAsync(mine.id))}
                style={styles.btn}
              />
              {mine.assignedBy && mine.assignedBy.id !== user?.id ? (
                <FactoryButton
                  label="Recusar"
                  variant="secondary"
                  loading={decline.isPending}
                  disabled={start.isPending}
                  onPress={() => run(() => decline.mutateAsync(mine.id))}
                  style={styles.btnSmall}
                />
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}

      {multi && others.length > 0 ? (
        <View style={styles.others}>
          {others.map((s) => (
            <View key={s.id} style={styles.otherRow}>
              <View style={styles.otherInfo}>
                <Text style={styles.otherName} numberOfLines={1}>
                  Parte {s.shareIndex} · {s.assignedTo.name}
                </Text>
                <Text style={styles.otherMeta}>
                  {WORK_STATUS_LABEL[s.status]} · {s.itemsDone}/{s.itemsTotal} itens
                </Text>
              </View>
              {s.status === "STARTED" || s.status === "FINISHED" ? (
                <WorkTimer share={s} style={styles.otherTimer} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Mensagem para bloquear leitura antes de tocar em Iniciar. */
export function workBlockedMessage(work: WorkRefDto | null | undefined): string | null {
  const mine = work?.mine;
  if (!work || work.shares.length === 0) return null;
  if (!mine) return "Essa tarefa foi dividida e não há parte sua aqui.";
  if (mine.status === "RESERVED") return "Toque em Iniciar para começar sua parte.";
  if (mine.status === "DECLINED") return "Você recusou esta parte.";
  return null;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  card: {
    backgroundColor: theme.warningSoft,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.warning,
    padding: spacing.md,
  },
  cardRunning: { borderColor: theme.primary, backgroundColor: theme.primarySoft },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: typography.body, fontWeight: "900", color: theme.text },
  meta: { color: theme.textMuted, fontWeight: "600", marginTop: 2 },
  timer: {
    fontSize: typography.subtitle,
    fontWeight: "900",
    color: theme.primary,
    fontVariant: ["tabular-nums"],
  },
  btn: { marginTop: spacing.sm, marginBottom: 0 },
  btnSmall: { marginTop: spacing.xs, marginBottom: 0 },
  others: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  otherRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  otherInfo: { flex: 1 },
  otherName: { fontWeight: "800", color: theme.text },
  otherMeta: { fontSize: typography.caption, color: theme.textMuted },
  otherTimer: { fontSize: typography.body },
});
