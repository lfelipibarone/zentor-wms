import { router } from "expo-router";
import { useState } from "react";
import { FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FactoryButton } from "@/components/FactoryButton";
import { CollectionDeadlineRow } from "@/components/CollectionDeadlineRow";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { SplitWorkModal } from "@/components/SplitWorkModal";
import { WorkShareCard, workBlockedMessage } from "@/components/WorkTimer";
import { Badge, Card, EmptyState, Loading, ProgressBar } from "@/components/ui";
import { useCurrentWave, useReleaseWaveAccept } from "@/hooks/useWavePicking";
import { useSplitWork } from "@/hooks/useWorkShares";
import { showErrorAlert, showToast } from "@/lib/app-alert";
import { ApiError } from "@/lib/api";
import type { WaveLineSummary } from "@/lib/api";
import { modules } from "@/lib/modules";
import { theme, spacing, typography, radius } from "@/lib/theme";
import type { Tone } from "@/lib/theme";

const color = modules.picking.color;

function lineStatus(line: WaveLineSummary): { label: string; tone: Tone } {
  if (line.sortStatus === "SORTED") return { label: "Concluído", tone: "success" };
  if (line.sortStatus === "PICKED") return { label: "No packing", tone: "info" };
  if (line.quantityPicked > 0) return { label: "Em andamento", tone: "warning" };
  return { label: "Pendente", tone: "neutral" };
}

export function WavePickingPanel() {
  const { data, isLoading, error, refetch, isRefetching } = useCurrentWave();
  const splitWork = useSplitWork();
  const [splitOpen, setSplitOpen] = useState(false);
  const releaseWave = useReleaseWaveAccept(data?.wave.id, data?.wave.part?.id);

  if (isLoading) return <Loading />;

  if (error || !data) {
    return (
      <ScrollView contentContainerStyle={styles.centered}>
        <EmptyState
          icon="layers-outline"
          title={error instanceof Error ? error.message : "Nenhuma onda liberada"}
          action={
            <FactoryButton
              label="Atualizar"
              icon="refresh"
              size="md"
              variant="secondary"
              onPress={() => refetch()}
              loading={isRefetching}
            />
          }
        />
      </ScrollView>
    );
  }

  const { wave, lines, work } = data;
  const blocked = workBlockedMessage(work);
  const pending = lines.filter((l) => l.sortStatus !== "SORTED");
  const unitsTotal = lines.reduce((n, l) => n + l.quantityTotal, 0);
  const unitsPicked = lines.reduce((n, l) => n + l.quantityPicked, 0);
  const canReleaseWave =
    wave.canWork && lines.every((l) => l.quantityPicked === 0);

  const handleReleaseWave = async () => {
    try {
      await releaseWave.mutateAsync();
      await refetch();
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao cancelar aceite",
      );
    }
  };

  const waveCard = (
    <View style={styles.waveCard}>
      <View style={styles.waveTop}>
        <View style={styles.waveIcon}>
          <Ionicons name="layers" size={22} color="#fff" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.waveName} numberOfLines={2}>
            {wave.name}
          </Text>
          {wave.part ? <Text style={styles.wavePart}>{wave.part.name}</Text> : null}
        </View>
      </View>
      <View style={styles.waveStats}>
        <Stat value={wave.orderCount} label="pedidos" />
        <Stat value={lines.length} label="linhas" />
        <Stat value={unitsTotal} label="un." />
      </View>
      <View style={styles.badges}>
        <CollectionDeadlineRow deadline={wave.collectionDeadline} />
        {(wave.marketplaces ?? []).map((m) => (
          <Badge key={m} label={m} />
        ))}
      </View>
    </View>
  );

  if (wave.canAccept) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        {waveCard}
        <FactoryButton
          label={wave.part ? "Aceitar parte" : "Aceitar onda"}
          icon="hand-left"
          color={color}
          onPress={() => setSplitOpen(true)}
          loading={splitWork.isPending}
        />
        <SplitWorkModal
          visible={splitOpen}
          title={wave.part ? `${wave.name} · ${wave.part.name}` : wave.name}
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
              .then(() => {
                setSplitOpen(false);
                void refetch();
              })
              .catch((e) => {
                showErrorAlert(
                  e instanceof ApiError ? e.message : "Erro ao aceitar onda",
                );
              });
          }}
        />
      </ScrollView>
    );
  }

  if (!wave.canWork) {
    return (
      <ScrollView contentContainerStyle={styles.scroll}>
        {waveCard}
        <Card>
          <View style={styles.lockedRow}>
            <Ionicons name="lock-closed" size={20} color={theme.textMuted} />
            <Text style={styles.lockedText}>
              Com {wave.acceptedByName ?? "outro operador"}
            </Text>
          </View>
        </Card>
        <FactoryButton
          label="Atualizar"
          icon="refresh"
          size="md"
          variant="secondary"
          onPress={() => refetch()}
          loading={isRefetching}
        />
      </ScrollView>
    );
  }

  const listHeader = (
    <View style={styles.listHeader}>
      {waveCard}
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>
          {unitsPicked}/{unitsTotal} un.
        </Text>
        <Text style={styles.progressMuted}>{pending.length} linhas pendentes</Text>
      </View>
      <ProgressBar value={unitsPicked} total={unitsTotal} color={color} />
      <WorkShareCard work={work} />
      {canReleaseWave ? (
        <FactoryButton
          label="Cancelar aceite"
          icon="close"
          size="sm"
          variant="ghost"
          onPress={handleReleaseWave}
          loading={releaseWave.isPending}
        />
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.flex}
      data={lines}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={isRefetching}
      onRefresh={refetch}
      ListHeaderComponent={listHeader}
      renderItem={({ item }) => {
        const done =
          item.sortStatus === "PICKED" || item.sortStatus === "SORTED";
        const status = lineStatus(item);
        const openLine = () => {
          if (blocked && !done) {
            showToast(blocked);
            return;
          }
          if (done) {
            showToast(
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
        };

        return (
          <Card
            onPress={openLine}
            muted={done}
            accent={done ? theme.success : item.quantityPicked > 0 ? theme.warning : color}
          >
            <View style={styles.lineRow}>
              <ProductThumbnail
                imageUrl={item.product.imageUrl}
                alt={item.product.name}
                size={56}
              />
              <View style={styles.flex}>
                <View style={styles.lineTop}>
                  <Text style={styles.location} numberOfLines={1}>
                    {item.pickLocation.label}
                  </Text>
                  <Badge label={status.label} tone={status.tone} />
                </View>
                <Text style={styles.sku} numberOfLines={1}>
                  {item.product.sku}
                </Text>
                <Text style={styles.productName} numberOfLines={1}>
                  {item.product.name}
                </Text>
              </View>
            </View>
            <View style={styles.qtyRow}>
              <Text style={styles.qtyMain}>
                {item.quantityPicked}
                <Text style={styles.qtyOf}> / {item.quantityTotal} un.</Text>
              </Text>
              <CollectionDeadlineRow deadline={item.collectionDeadline} compact />
              {!done ? <Ionicons name="chevron-forward" size={24} color={theme.textSoft} /> : null}
            </View>
          </Card>
        );
      }}
    />
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flexGrow: 1, justifyContent: "center", padding: spacing.lg },
  scroll: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  list: { padding: spacing.md, paddingBottom: spacing.xl * 2, gap: spacing.sm },
  listHeader: { gap: spacing.sm, marginBottom: spacing.xs },
  waveCard: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: color,
    padding: spacing.md,
    gap: spacing.md,
  },
  waveTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  waveIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: color,
    alignItems: "center",
    justifyContent: "center",
  },
  waveName: { fontSize: typography.subtitle, fontWeight: "900", color: theme.text },
  wavePart: { color: color, fontWeight: "800", fontSize: typography.caption },
  waveStats: { flexDirection: "row", gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: modules.picking.soft,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  statValue: { fontSize: 24, fontWeight: "900", color: "#0F766E" },
  statLabel: { fontSize: typography.small, fontWeight: "800", color: "#0F766E" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  lockedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  lockedText: { fontWeight: "800", color: theme.textMuted, fontSize: typography.body },
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  progressText: { fontWeight: "900", fontSize: typography.body, color: theme.text },
  progressMuted: { color: theme.textMuted, fontWeight: "700", fontSize: typography.caption },
  lineRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  lineTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  location: {
    flex: 1,
    fontSize: typography.subtitle,
    fontWeight: "900",
    color: theme.text,
  },
  sku: { fontWeight: "800", color: theme.info, fontSize: typography.caption + 1 },
  productName: { color: theme.textMuted, fontSize: typography.caption },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  qtyMain: { flex: 1, fontSize: 26, fontWeight: "900", color: theme.text },
  qtyOf: { fontSize: typography.body, fontWeight: "700", color: theme.textMuted },
});
