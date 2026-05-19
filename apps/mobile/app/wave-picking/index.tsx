import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { useAcceptWave, useCurrentWave } from "@/hooks/useWavePicking";
import type { WaveLineSummary } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

function statusLabel(line: WaveLineSummary) {
  if (line.sortStatus === "SORTED") return "Concluído";
  if (line.sortStatus === "PICKED") return "Packing no web";
  if (line.quantityPicked > 0) return "Em andamento";
  return "Pendente";
}

export default function WavePickingListScreen() {
  const { data, isLoading, error, refetch, isRefetching } = useCurrentWave();
  const acceptWave = useAcceptWave();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.loadingText}>Carregando onda...</Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>
          {error instanceof Error
            ? error.message
            : "Nenhuma onda ativa. Libere uma onda no painel web."}
        </Text>
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={() => refetch()}
        />
      </View>
    );
  }

  const { wave, lines } = data;
  const pending = lines.filter((l) => l.sortStatus !== "SORTED");

  if (wave.canAccept) {
    return (
      <View style={styles.centered}>
        <Text style={styles.waveName}>{wave.name}</Text>
        <Text style={styles.waveMeta}>
          {wave.orderCount} pedidos · {wave.gondolaPasses} passagens na gôndola
        </Text>
        <Text style={styles.acceptHint}>
          Mesmo SKU agrupado — você fará o pick consolidado e depois o packing
          nas cestas de cada pedido.
        </Text>
        <FactoryButton
          label="Aceitar esta onda"
          onPress={() => acceptWave.mutate()}
          loading={acceptWave.isPending}
        />
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={() => refetch()}
        />
      </View>
    );
  }

  if (!wave.canWork) {
    return (
      <View style={styles.centered}>
        <Text style={styles.waveName}>{wave.name}</Text>
        <Text style={styles.error}>
          Onda aceita por {wave.acceptedByName ?? "outro operador"}.
        </Text>
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={() => refetch()}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.waveName}>{wave.name}</Text>
        <Text style={styles.waveMeta}>
          {wave.orderCount} pedidos · {wave.gondolaPasses} gôndolas ·{" "}
          {pending.length} linhas pendentes
        </Text>
        <Text style={styles.acceptHint}>Você está executando esta onda</Text>
      </View>

      <FlatList
        data={lines}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={isRefetching}
        onRefresh={refetch}
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.card,
              item.sortStatus === "SORTED" && styles.cardDone,
            ]}
            onPress={() => {
              if (item.sortStatus === "PICKED") {
                return;
              }
              router.push({
                pathname: "/wave-picking/[lineId]/pick",
                params: { lineId: item.id },
              });
            }}
          >
            <View style={styles.cardTop}>
              <Text style={styles.sku}>{item.product.sku}</Text>
              <Text style={styles.badge}>{statusLabel(item)}</Text>
            </View>
            <Text style={styles.productName} numberOfLines={2}>
              {item.product.name}
            </Text>
            <Text style={styles.location}>{item.pickLocation.label}</Text>
            {item.gondolaHint ? (
              <Text style={styles.gondolaHint}>{item.gondolaHint}</Text>
            ) : null}
            <View style={styles.qtyRow}>
              <Text style={styles.qtyMain}>
                {item.quantityPicked} / {item.quantityTotal} un.
              </Text>
              <Text style={styles.orders}>{item.ordersCount} pedido(s)</Text>
            </View>
            {item.remaining > 0 ? (
              <Text style={styles.remaining}>
                Faltam {item.remaining} un. na gôndola
              </Text>
            ) : item.sortStatus === "PICKED" ? (
              <Text style={styles.hint}>
                Pick concluído — finalize o packing no painel web
              </Text>
            ) : null}
          </Pressable>
        )}
      />

      <FactoryButton
        label="Atualizar onda"
        variant="secondary"
        onPress={() => refetch()}
        loading={isRefetching}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: spacing.md },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
    backgroundColor: theme.bg,
  },
  loadingText: { marginTop: spacing.md, color: theme.textMuted },
  error: {
    color: theme.danger,
    textAlign: "center",
    fontWeight: "700",
    marginBottom: spacing.lg,
  },
  header: { marginBottom: spacing.md },
  waveName: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.primary,
    textAlign: "center",
  },
  waveMeta: {
    color: theme.textMuted,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  acceptHint: {
    color: theme.textMuted,
    textAlign: "center",
    marginVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  list: { paddingBottom: spacing.md, gap: spacing.sm },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: theme.primary,
  },
  cardDone: { borderColor: theme.border, opacity: 0.85 },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sku: { fontWeight: "900", color: theme.info, fontSize: typography.subtitle },
  badge: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.primary,
    backgroundColor: theme.bg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 8,
  },
  productName: {
    fontSize: typography.body,
    fontWeight: "700",
    color: theme.text,
    marginTop: spacing.xs,
  },
  location: {
    fontFamily: "monospace",
    color: theme.textMuted,
    marginTop: spacing.xs,
  },
  gondolaHint: {
    color: theme.info,
    fontWeight: "600",
    marginTop: spacing.xs,
    fontSize: typography.caption,
  },
  qtyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    alignItems: "flex-end",
  },
  qtyMain: { fontSize: 28, fontWeight: "900", color: theme.text },
  orders: { color: theme.textMuted, fontWeight: "600" },
  remaining: { color: theme.warning, fontWeight: "700", marginTop: spacing.sm },
  hint: { color: theme.success, fontWeight: "600", marginTop: spacing.sm },
});
