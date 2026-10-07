import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { CollectionDeadlineRow } from "@/components/CollectionDeadlineRow";
import { SplitWorkModal } from "@/components/SplitWorkModal";
import { WorkShareCard, workBlockedMessage } from "@/components/WorkTimer";
import { useReleasedWaves, useWaveById } from "@/hooks/useWavePicking";
import { useSplitWork } from "@/hooks/useWorkShares";
import type { WaveLineSummary } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { showErrorAlert, showInfoAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";

function statusLabel(line: WaveLineSummary) {
  if (line.sortStatus === "SORTED") return "Concluído";
  if (line.sortStatus === "PICKED") return "Packing no web";
  if (line.quantityPicked > 0) return "Em andamento";
  return "Pendente";
}

type WaveEntry = {
  key: string;
  waveId: string;
  partId: string | null;
  title: string;
  color: string | null;
  orderCount: number;
  lineCount: number;
  acceptedByName: string | null;
  collectionDeadline: string | null;
  marketplaces?: string[];
};

export default function WavePickingListScreen() {
  const params = useLocalSearchParams<{ waveId?: string; partId?: string }>();
  const released = useReleasedWaves();
  const [selected, setSelected] = useState<{ waveId: string; partId: string | null } | null>(
    params.waveId ? { waveId: params.waveId, partId: params.partId ?? null } : null,
  );
  const [splitOpen, setSplitOpen] = useState(false);
  const splitWork = useSplitWork();

  useEffect(() => {
    if (params.waveId) setSelected({ waveId: params.waveId, partId: params.partId ?? null });
  }, [params.waveId, params.partId]);

  const waves = released.data?.waves ?? [];
  const entries = waves.flatMap((w): WaveEntry[] =>
    w.parts.length > 0
      ? w.parts.map((p) => ({
          key: `${w.id}:${p.id}`,
          waveId: w.id,
          partId: p.id,
          title: `${w.name} · ${p.name}`,
          color: p.color,
          orderCount: w.orderCount,
          lineCount: p.pendingCount,
          acceptedByName: p.acceptedByName,
          collectionDeadline: w.collectionDeadline,
          marketplaces: w.marketplaces,
        }))
      : [
          {
            key: w.id,
            waveId: w.id,
            partId: null,
            title: w.name,
            color: null,
            orderCount: w.orderCount,
            lineCount: w.lineCount,
            acceptedByName: w.acceptedByName,
            collectionDeadline: w.collectionDeadline,
            marketplaces: w.marketplaces,
          },
        ],
  );
  const active = selected ?? (entries[0] ? { waveId: entries[0].waveId, partId: entries[0].partId } : null);

  const { data, isLoading, error, refetch, isRefetching } = useWaveById(active?.waveId ?? null, active?.partId);

  if (released.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.loadingText}>Carregando ondas...</Text>
      </View>
    );
  }

  if (released.error || entries.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>
          {released.error instanceof Error
            ? released.error.message
            : "Nenhuma onda ativa. Libere ondas no painel web."}
        </Text>
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={() => released.refetch()}
        />
      </View>
    );
  }

  if (entries.length > 1 && !selected) {
    return (
      <View style={styles.container}>
        <Text style={styles.waveName}>Ondas liberadas</Text>
        <Text style={styles.waveMeta}>
          Escolha a onda para separar (ordenadas por urgência de coleta)
        </Text>
        <FlatList
          data={entries}
          keyExtractor={(e) => e.key}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.card, item.color ? { borderColor: item.color } : null]}
              onPress={() => setSelected({ waveId: item.waveId, partId: item.partId })}
            >
              <Text style={styles.sku}>{item.title}</Text>
              <CollectionDeadlineRow deadline={item.collectionDeadline} />
              <Text style={styles.location}>
                {item.orderCount} pedidos · {item.lineCount} linhas
              </Text>
              {item.marketplaces && item.marketplaces.length > 0 ? (
                <Text style={styles.marketplaces}>
                  {item.marketplaces.join(" · ")}
                </Text>
              ) : null}
              {item.acceptedByName ? (
                <Text style={styles.hint}>Aceita por {item.acceptedByName}</Text>
              ) : (
                <Text style={styles.remaining}>Disponível para aceite</Text>
              )}
            </Pressable>
          )}
        />
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={() => released.refetch()}
        />
      </View>
    );
  }

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
          {error instanceof Error ? error.message : "Erro ao carregar onda"}
        </Text>
        <FactoryButton
          label="Voltar"
          variant="secondary"
          onPress={() => setSelected(null)}
        />
      </View>
    );
  }

  const { wave, lines, work } = data;
  const blocked = workBlockedMessage(work);
  const pending = lines.filter((l) => l.sortStatus !== "SORTED");
  const waveTitle = wave.part ? `${wave.name} · ${wave.part.name}` : wave.name;

  if (wave.canAccept) {
    return (
      <View style={styles.centered}>
        {entries.length > 1 ? (
          <FactoryButton
            label="Trocar onda"
            variant="secondary"
            onPress={() => setSelected(null)}
          />
        ) : null}
        <Text style={styles.waveName}>{waveTitle}</Text>
        <CollectionDeadlineRow deadline={wave.collectionDeadline} />
        <Text style={styles.waveMeta}>
          {wave.orderCount} pedidos · {wave.gondolaPasses} passagens na gôndola
        </Text>
        {wave.marketplaces && wave.marketplaces.length > 0 ? (
          <Text style={styles.marketplaces}>
            {wave.marketplaces.join(" · ")}
          </Text>
        ) : null}
        <Text style={styles.acceptHint}>
          Mesmo SKU agrupado — pick consolidado; packing nas cestas no web.
        </Text>
        <FactoryButton
          label={wave.part ? "Aceitar esta parte" : "Aceitar esta onda"}
          onPress={() => setSplitOpen(true)}
          loading={splitWork.isPending}
        />
        <SplitWorkModal
          visible={splitOpen}
          title={waveTitle}
          subtitle={`${lines.length} linhas · ${wave.orderCount} pedidos`}
          itemCount={lines.filter((l) => l.quantityPicked === 0).length}
          loading={splitWork.isPending}
          onCancel={() => setSplitOpen(false)}
          onConfirm={(colleagueIds) => {
            splitWork
              .mutateAsync({
                kind: "PICK_WAVE",
                refId: wave.id,
                partId: wave.part?.id,
                colleagueIds,
              })
              .then((res) => {
                setSplitOpen(false);
                setSelected({ waveId: wave.id, partId: res.mine?.wavePartId ?? wave.part?.id ?? null });
                void released.refetch();
              })
              .catch((e) => {
                showErrorAlert(
                  e instanceof ApiError ? e.message : "Erro ao aceitar onda",
                );
              });
          }}
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
        <Text style={styles.waveName}>{waveTitle}</Text>
        <Text style={styles.error}>
          {wave.part ? "Parte aceita por" : "Onda aceita por"} {wave.acceptedByName ?? "outro operador"}.
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
        {entries.length > 1 ? (
          <FactoryButton
            label="Trocar onda"
            variant="secondary"
            onPress={() => setSelected(null)}
          />
        ) : null}
        <Text style={styles.waveName}>{waveTitle}</Text>
        <CollectionDeadlineRow deadline={wave.collectionDeadline} />
        <Text style={styles.waveMeta}>
          {wave.orderCount} pedidos · {wave.gondolaPasses} gôndolas ·{" "}
          {pending.length} linhas pendentes
        </Text>
        {wave.marketplaces && wave.marketplaces.length > 0 ? (
          <Text style={styles.marketplaces}>
            {wave.marketplaces.join(" · ")}
          </Text>
        ) : null}
        <WorkShareCard work={work} />
      </View>

      <FlatList
        data={lines}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={isRefetching}
        onRefresh={refetch}
        renderItem={({ item }) => {
          const done =
            item.sortStatus === "PICKED" || item.sortStatus === "SORTED";
          return (
            <Pressable
              style={[styles.card, done && styles.cardDone]}
              onPress={() => {
                if (blocked && !done) {
                  showInfoAlert(blocked);
                  return;
                }
                if (done) {
                  showInfoAlert(
                    item.sortStatus === "PICKED"
                      ? "Pick concluído — finalize o packing no painel web."
                      : "Linha já concluída.",
                  );
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
              <CollectionDeadlineRow
                deadline={item.collectionDeadline}
                compact
              />
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
          );
        }}
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
  marketplaces: {
    color: theme.textMuted,
    marginTop: spacing.xs,
    textAlign: "center",
    fontSize: typography.caption,
    fontWeight: "600",
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
