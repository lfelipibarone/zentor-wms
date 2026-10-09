import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { PulmaoLocationPicker } from "@/components/PulmaoLocationPicker";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { PulmaoStockList } from "@/components/PulmaoStockList";
import { PutawaySummary } from "@/components/PutawaySummary";
import { PercentInput } from "@/components/PercentInput";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import { SplitWorkModal } from "@/components/SplitWorkModal";
import { WorkShareCard, workBlockedMessage } from "@/components/WorkTimer";
import {
  Badge,
  BigCode,
  Card,
  EmptyState,
  Loading,
  Notice,
  ProgressBar,
  Steps,
} from "@/components/ui";
import {
  useCompletePutaway,
  usePutawaySession,
  useStorePutawayItem,
} from "@/hooks/usePutaway";
import { useSplitWork } from "@/hooks/useWorkShares";
import { ApiError, type LocationLookup } from "@/lib/api";
import { modules } from "@/lib/modules";
import { theme, spacing, typography, radius } from "@/lib/theme";

type Phase = "scan-location" | "confirm-qty" | "confirm-pct";

export default function PutawaySessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { data, isLoading } = usePutawaySession(sessionId);
  const store = useStorePutawayItem(sessionId ?? "");
  const complete = useCompletePutaway(sessionId ?? "");
  const [phase, setPhase] = useState<Phase>("scan-location");
  const [selectedLocation, setSelectedLocation] = useState<LocationLookup | null>(
    null,
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pendingQty, setPendingQty] = useState<number | null>(null);

  const next = data?.nextItem;
  const nextStored =
    data?.items.find((it) => it.id === next?.id)?.storedLocations ?? [];
  const finished = data?.session.status === "COMPLETED";
  const work = data?.work;
  const shared = (work?.shares.length ?? 0) > 0;
  const blocked = workBlockedMessage(work);
  const pendingCount = data?.items.filter((it) => !it.completed).length ?? 0;
  const needsAccept = Boolean(data) && !shared && !finished && pendingCount > 0;
  const myItems = shared
    ? (data?.items ?? []).filter((it) => it.workShareId && it.workShareId === work?.mine?.id)
    : data?.items ?? [];
  const myDone = shared ? Boolean(data?.myAllStored) : Boolean(data?.allStored);
  const [splitOpen, setSplitOpen] = useState(false);
  const splitWork = useSplitWork();

  useEffect(() => {
    setPhase("scan-location");
    setSelectedLocation(null);
    setPendingQty(null);
  }, [next?.id]);

  const currentSkuPercent =
    selectedLocation && next?.productCode
      ? selectedLocation.stocks.find(
          (st) => st.product.sku.toUpperCase() === next.productCode!.toUpperCase(),
        )?.percent ?? null
      : null;

  const handleLocationSelect = (loc: LocationLookup) => {
    setSelectedLocation(loc);
    setPhase("confirm-qty");
    setFeedback(`Local ${loc.label} — informe a quantidade`);
  };

  const handleConfirmQty = (qty: number) => {
    setPendingQty(qty);
    setPhase("confirm-pct");
  };

  const handleConfirmPercent = async (pulmaoPercent: number) => {
    if (!next || !selectedLocation || pendingQty == null) return;
    const qty = pendingQty;
    try {
      const updated = await store.mutateAsync({
        itemId: next.id,
        locationBarcode: selectedLocation.barcode,
        quantity: qty,
        pulmaoPercent,
      });
      const storedMsg = `${qty} un. de ${next.productCode ?? "item"} guardadas em ${selectedLocation.label} (SKU ocupa ${pulmaoPercent}%)`;
      setSelectedLocation(null);
      setPendingQty(null);
      setPhase("scan-location");
      if (updated.session.status === "COMPLETED" || updated.allStored) {
        setFeedback(`${storedMsg}. Todos os itens armazenados ✓`);
      } else if (updated.myAllStored && (updated.work?.shares.length ?? 0) > 0) {
        setFeedback(`${storedMsg}. Sua parte terminou ✓ — aguardando os colegas`);
      } else if (updated.nextItem) {
        setFeedback(
          `${storedMsg}. Próximo: ${updated.nextItem.description ?? updated.nextItem.productCode}`,
        );
      }
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Erro ao armazenar");
    }
  };

  const handleComplete = async () => {
    try {
      await complete.mutateAsync();
      setFeedback(null);
    } catch (e) {
      Alert.alert(
        "Erro",
        e instanceof ApiError ? e.message : "Não foi possível finalizar",
      );
    }
  };

  const handleSplit = async (colleagueIds: string[]) => {
    if (!data) return;
    try {
      await splitWork.mutateAsync({
        kind: "PUTAWAY",
        refId: data.session.purchaseReceiptId,
        colleagueIds,
      });
      setSplitOpen(false);
    } catch (e) {
      Alert.alert(
        "Erro",
        e instanceof ApiError ? e.message : "Não foi possível aceitar a armazenagem",
      );
    }
  };

  if (isLoading || !data) {
    return (
      <ScreenShell module="armazenagem" title="Armazenagem">
        <Loading />
      </ScreenShell>
    );
  }

  if (finished) {
    return (
      <ScreenShell scroll module="armazenagem" title="Armazenagem concluída">
        <WorkShareCard work={work} />
        <PutawaySummary items={data.items} />
        <FactoryButton
          label="OK"
          icon="checkmark"
          color={color}
          onPress={() => router.replace("/putaway")}
        />
      </ScreenShell>
    );
  }

  const doneCount = myItems.filter((it) => it.completed).length;
  const stepIndex = phase === "scan-location" ? 0 : phase === "confirm-qty" ? 1 : 2;
  const feedbackError =
    feedback != null && !feedback.includes("guardadas") && !feedback.startsWith("Local ");

  return (
    <ScreenShell
      scroll
      module="armazenagem"
      title="Armazenagem"
      headerRight={
        <Text style={styles.headerCount}>
          {doneCount}/{myItems.length}
        </Text>
      }
    >
      <ProgressBar value={doneCount} total={myItems.length} color={color} />

      {feedback ? (
        <Notice tone={feedbackError ? "danger" : "success"} onClose={() => setFeedback(null)}>
          {feedback}
        </Notice>
      ) : null}

      <WorkShareCard work={work} />

      <SplitWorkModal
        visible={splitOpen}
        title="Armazenagem no pulmão"
        subtitle={`${pendingCount} itens pendentes`}
        itemCount={pendingCount}
        loading={splitWork.isPending}
        onCancel={() => setSplitOpen(false)}
        onConfirm={handleSplit}
      />

      {needsAccept ? (
        <FactoryButton
          label="Aceitar armazenagem"
          icon="hand-left"
          color={color}
          onPress={() => setSplitOpen(true)}
          loading={splitWork.isPending}
        />
      ) : blocked ? (
        <Notice tone="warning">{blocked}</Notice>
      ) : shared && myDone ? (
        <>
          <EmptyState icon="checkmark-circle" title="Sua parte foi armazenada" />
          <PutawaySummary items={myItems} title="Onde você guardou" />
          <FactoryButton
            label="Voltar à fila"
            icon="arrow-back"
            variant="secondary"
            onPress={() => router.replace("/putaway")}
          />
        </>
      ) : data.allStored ? (
        <>
          <PutawaySummary items={data.items} title="Confira" />
          <FactoryButton
            label="Finalizar armazenagem"
            icon="checkmark-done"
            variant="success"
            onPress={handleComplete}
            loading={complete.isPending}
          />
        </>
      ) : (
        <>
          {next ? (
            <Card accent={color}>
              <View style={styles.productRow}>
                <ProductThumbnail
                  imageUrl={next.imageUrl}
                  alt={next.description ?? next.productCode ?? ""}
                  size={72}
                />
                <View style={styles.productMeta}>
                  <Text style={styles.productCode}>{next.productCode}</Text>
                  {next.description ? (
                    <Text style={styles.productDesc} numberOfLines={2}>
                      {next.description}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.qtyBox}>
                  <Text style={styles.qtyValue}>{next.remaining}</Text>
                  <Text style={styles.qtyLabel}>un.</Text>
                </View>
              </View>
              {nextStored.length > 0 ? (
                <View style={styles.storedWrap}>
                  {nextStored.map((loc) => (
                    <Badge
                      key={loc.locationId}
                      icon="location"
                      label={`${loc.quantity} un. em ${loc.label}`}
                    />
                  ))}
                </View>
              ) : null}
            </Card>
          ) : null}

          <Steps steps={["Pulmão", "Quantidade", "%"]} current={stepIndex} color={color} />

          {phase === "scan-location" ? (
            <PulmaoLocationPicker
              defaultSku={next?.productCode ?? ""}
              onSelect={handleLocationSelect}
              disabled={store.isPending}
            />
          ) : next && selectedLocation ? (
            <>
              <BigCode
                label="Pulmão"
                code={selectedLocation.label}
                meta={`Ocupação ${selectedLocation.fillPercent}%`}
                color={color}
              />
              <PulmaoStockList stocks={selectedLocation.stocks} />
              {phase === "confirm-qty" ? (
                <QuantityInput
                  label="Unidades a guardar"
                  max={next.remaining}
                  onConfirm={handleConfirmQty}
                />
              ) : (
                <>
                  <PercentInput
                    label={`% do ${next.productCode ?? "SKU"} no pulmão`}
                    hint={
                      currentSkuPercent != null
                        ? `${pendingQty} un. · antes ${currentSkuPercent}%`
                        : `${pendingQty} un.`
                    }
                    initialValue={currentSkuPercent}
                    resetKey={`${selectedLocation.id}-${next.id}`}
                    minPercent={1}
                    confirmLabel="Guardar"
                    loading={store.isPending}
                    onConfirm={handleConfirmPercent}
                  />
                  <FactoryButton
                    label="Corrigir quantidade"
                    icon="arrow-undo"
                    size="sm"
                    variant="secondary"
                    onPress={() => setPhase("confirm-qty")}
                  />
                </>
              )}
              <FactoryButton
                label="Trocar pulmão"
                icon="swap-horizontal"
                size="sm"
                variant="secondary"
                onPress={() => {
                  setPhase("scan-location");
                  setSelectedLocation(null);
                  setPendingQty(null);
                }}
              />
            </>
          ) : null}
        </>
      )}
    </ScreenShell>
  );
}

const color = modules.armazenagem.color;

const styles = StyleSheet.create({
  headerCount: { color: theme.headerTint, fontWeight: "900", fontSize: typography.body },
  productRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  productMeta: { flex: 1, gap: 2 },
  productCode: { fontWeight: "900", fontSize: typography.body, color: theme.text },
  productDesc: { color: theme.textMuted, fontSize: typography.caption, fontWeight: "600" },
  qtyBox: {
    minWidth: 64,
    alignItems: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: modules.armazenagem.soft,
  },
  qtyValue: { fontSize: 30, fontWeight: "900", color },
  qtyLabel: { fontSize: typography.small, fontWeight: "800", color },
  storedWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
});
