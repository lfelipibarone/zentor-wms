import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { useColleagues } from "@/hooks/useWorkShares";
import { theme, spacing, typography } from "@/lib/theme";

const COUNT_OPTIONS = [1, 2, 3, 4];
const MAX_AGENTS = 10;

interface SplitWorkModalProps {
  visible: boolean;
  title: string;
  subtitle?: string | null;
  /** Quantidade de itens que serão divididos (limita o nº de agentes). */
  itemCount?: number;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (colleagueIds: string[]) => void;
}

/** Pergunta quantos agentes vão fazer a tarefa e quem são os colegas. */
export function SplitWorkModal({
  visible,
  title,
  subtitle,
  itemCount,
  loading,
  onCancel,
  onConfirm,
}: SplitWorkModalProps) {
  const [count, setCount] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const colleaguesQuery = useColleagues(visible && count > 1);
  const colleagues = colleaguesQuery.data?.colleagues ?? [];

  useEffect(() => {
    if (visible) {
      setCount(1);
      setSelected([]);
    }
  }, [visible]);

  const maxAgents = Math.max(1, Math.min(MAX_AGENTS, itemCount ?? MAX_AGENTS));
  const needed = count - 1;

  const setAgents = (n: number) => {
    const next = Math.max(1, Math.min(maxAgents, n));
    setCount(next);
    setSelected((prev) => prev.slice(0, next - 1));
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= needed) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const ready = selected.length === needed;
  const confirmLabel =
    count === 1 ? "Aceitar sozinho" : `Dividir entre ${count} agentes`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

            <Text style={styles.label}>Quantos agentes vão fazer?</Text>
            <View style={styles.countRow}>
              {COUNT_OPTIONS.filter((n) => n <= maxAgents).map((n) => (
                <Pressable
                  key={n}
                  onPress={() => setAgents(n)}
                  style={[styles.countBtn, count === n && styles.countBtnActive]}
                >
                  <Text style={[styles.countText, count === n && styles.countTextActive]}>
                    {n}
                  </Text>
                </Pressable>
              ))}
              {maxAgents > COUNT_OPTIONS.length ? (
                <Pressable
                  onPress={() => setAgents(count < COUNT_OPTIONS.length ? COUNT_OPTIONS.length + 1 : count + 1)}
                  style={[styles.countBtn, count > COUNT_OPTIONS.length && styles.countBtnActive]}
                >
                  <Text
                    style={[
                      styles.countText,
                      count > COUNT_OPTIONS.length && styles.countTextActive,
                    ]}
                  >
                    {count > COUNT_OPTIONS.length ? `${count}` : "+"}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {count > 1 ? (
              <>
                <Text style={styles.label}>
                  Você fica com a parte 1. Escolha {needed}{" "}
                  {needed === 1 ? "colega" : "colegas"} ({selected.length}/{needed})
                </Text>
                {colleaguesQuery.isLoading ? (
                  <ActivityIndicator color={theme.primary} style={styles.loader} />
                ) : colleagues.length === 0 ? (
                  <Text style={styles.empty}>Nenhum colega com acesso ao app.</Text>
                ) : (
                  <View style={styles.list}>
                    {colleagues.map((c) => {
                      const idx = selected.indexOf(c.id);
                      const on = idx >= 0;
                      return (
                        <Pressable
                          key={c.id}
                          onPress={() => toggle(c.id)}
                          style={[styles.colleague, on && styles.colleagueOn]}
                        >
                          <Text style={[styles.colleagueName, on && styles.colleagueNameOn]}>
                            {c.name}
                          </Text>
                          {on ? <Text style={styles.partTag}>Parte {idx + 2}</Text> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </>
            ) : null}

            <FactoryButton
              label={confirmLabel}
              variant="success"
              onPress={() => onConfirm(selected)}
              disabled={!ready || loading}
              loading={loading}
            />
            <FactoryButton
              label="Voltar"
              variant="secondary"
              onPress={onCancel}
              disabled={loading}
              style={styles.cancelBtn}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

interface ColleaguePickerModalProps {
  visible: boolean;
  title: string;
  excludeIds?: string[];
  loading?: boolean;
  onCancel: () => void;
  onPick: (userId: string) => void;
}

export function ColleaguePickerModal({
  visible,
  title,
  excludeIds = [],
  loading,
  onCancel,
  onPick,
}: ColleaguePickerModalProps) {
  const colleaguesQuery = useColleagues(visible);
  const colleagues = (colleaguesQuery.data?.colleagues ?? []).filter(
    (c) => !excludeIds.includes(c.id),
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            {colleaguesQuery.isLoading || loading ? (
              <ActivityIndicator color={theme.primary} style={styles.loader} />
            ) : colleagues.length === 0 ? (
              <Text style={styles.empty}>Nenhum colega disponível.</Text>
            ) : (
              <View style={styles.list}>
                {colleagues.map((c) => (
                  <Pressable key={c.id} onPress={() => onPick(c.id)} style={styles.colleague}>
                    <Text style={styles.colleagueName}>{c.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <FactoryButton
              label="Voltar"
              variant="secondary"
              onPress={onCancel}
              disabled={loading}
              style={styles.cancelBtn}
            />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  card: { backgroundColor: theme.surface, borderRadius: 16, padding: spacing.lg },
  title: {
    fontSize: typography.subtitle,
    fontWeight: "800",
    color: theme.text,
    marginBottom: spacing.xs,
  },
  subtitle: { color: theme.textMuted, marginBottom: spacing.sm, fontWeight: "600" },
  label: {
    color: theme.text,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  countRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  countBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.border,
    backgroundColor: theme.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  countBtnActive: { borderColor: theme.primary, backgroundColor: theme.primary },
  countText: { fontSize: typography.subtitle, fontWeight: "900", color: theme.text },
  countTextActive: { color: theme.primaryText },
  loader: { marginVertical: spacing.md },
  empty: { color: theme.textMuted, textAlign: "center", marginVertical: spacing.md },
  list: { gap: spacing.xs, marginBottom: spacing.sm },
  colleague: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  colleagueOn: { borderColor: theme.primary, backgroundColor: "#F0FDFA" },
  colleagueName: { fontSize: typography.body, fontWeight: "700", color: theme.text },
  colleagueNameOn: { color: theme.primaryDark },
  partTag: { color: theme.primary, fontWeight: "800", fontSize: typography.caption },
  cancelBtn: { marginTop: spacing.sm },
});
