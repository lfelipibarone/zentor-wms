import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
  useCompletePutaway,
  usePutawaySession,
  useStorePutawayItem,
} from "@/hooks/usePutaway";
import { useSplitWork } from "@/hooks/useWorkShares";
import { ApiError, type LocationLookup } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

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
      <ScreenShell backToHome scroll title="Armazenagem">
        <ActivityIndicator size="large" color={theme.primary} />
      </ScreenShell>
    );
  }

  if (finished) {
    return (
      <ScreenShell backToHome scroll title="Armazenagem concluída" subtitle="Itens endereçados no pulmão">
        <WorkShareCard work={work} />
        <PutawaySummary items={data.items} />
        <FactoryButton label="OK" onPress={() => router.replace("/putaway")} />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      backToHome
      scroll
      title="Armazenagem"
      subtitle={
        next
          ? `${next.description ?? next.productCode} · faltam ${next.remaining}`
          : "Conferir e finalizar"
      }
    >
      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}

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
          onPress={() => setSplitOpen(true)}
          loading={splitWork.isPending}
        />
      ) : blocked ? (
        <Text style={styles.blocked}>{blocked}</Text>
      ) : shared && myDone ? (
        <>
          <Text style={styles.done}>Sua parte foi armazenada ✓ — aguardando os colegas</Text>
          <PutawaySummary items={myItems} title="Onde você guardou cada item" />
          <FactoryButton label="Voltar à fila" variant="secondary" onPress={() => router.replace("/putaway")} />
        </>
      ) : (
        <>
          {next && !data.allStored ? (
            <View style={styles.productRow}>
              <ProductThumbnail
                imageUrl={next.imageUrl}
                alt={next.description ?? next.productCode ?? ""}
                size={72}
              />
              <View style={styles.productMeta}>
                <Text style={styles.productCode}>{next.productCode}</Text>
                {next.description ? (
                  <Text style={styles.productDesc}>{next.description}</Text>
                ) : null}
                <Text style={styles.productRemaining}>
                  Faltam {next.remaining} un.
                </Text>
                {nextStored.map((loc) => (
                  <Text key={loc.locationId} style={styles.storedLine}>
                    Já guardado: {loc.quantity} un. em {loc.label}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}

          {data.allStored ? (
            <>
              <PutawaySummary items={data.items} title="Confira onde cada item foi guardado" />
              <FactoryButton
                label="Finalizar armazenagem"
                onPress={handleComplete}
                loading={complete.isPending}
              />
            </>
          ) : (
            <>
              {phase === "scan-location" ? (
                <>
                  <Text style={styles.hint}>
                    1. Escolha o local de pulmão (bip ou busca por SKU)
                  </Text>
                  <PulmaoLocationPicker
                    defaultSku={next?.productCode ?? ""}
                    onSelect={handleLocationSelect}
                    disabled={store.isPending}
                  />
                </>
              ) : next && selectedLocation ? (
                <>
                  <View style={styles.locCard}>
                    <Text style={styles.locTitle}>{selectedLocation.label}</Text>
                    <Text style={styles.locMeta}>Ocupação: {selectedLocation.fillPercent}%</Text>
                    <PulmaoStockList stocks={selectedLocation.stocks} />
                  </View>
                  {phase === "confirm-qty" ? (
                    <>
                      <Text style={styles.hint}>
                        2. Quantidade para {next.description ?? next.productCode}
                      </Text>
                      <QuantityInput
                        label="Unidades a armazenar"
                        max={next.remaining}
                        onConfirm={handleConfirmQty}
                      />
                    </>
                  ) : (
                    <>
                      <Text style={styles.hint}>
                        3. {pendingQty} un. de {next.productCode} — quanto o SKU ocupa no pulmão?
                      </Text>
                      <PercentInput
                        label="% do SKU neste pulmão"
                        hint={
                          currentSkuPercent != null
                            ? `Antes ocupava ${currentSkuPercent}%. Informe o total depois de guardar.`
                            : "Informe quanto este SKU ocupa do pulmão depois de guardar."
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
                        variant="secondary"
                        onPress={() => setPhase("confirm-qty")}
                      />
                    </>
                  )}
                  <FactoryButton
                    label="Trocar local"
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
        </>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  productRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
    alignItems: "center",
  },
  productMeta: { flex: 1, gap: 2 },
  productCode: { fontWeight: "900", fontSize: typography.body },
  productDesc: { color: theme.textMuted, fontSize: typography.caption },
  productRemaining: {
    color: theme.primary,
    fontWeight: "800",
    fontSize: typography.caption,
    marginTop: 4,
  },
  storedLine: {
    color: theme.text,
    fontWeight: "700",
    fontSize: typography.caption,
    marginTop: 2,
  },
  locCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: theme.primary,
  },
  locTitle: {
    fontSize: typography.subtitle,
    fontWeight: "900",
    color: theme.primary,
  },
  locMeta: {
    color: theme.textMuted,
    fontSize: typography.caption,
    marginTop: 4,
  },
  feedback: {
    marginBottom: spacing.md,
    padding: spacing.sm,
    backgroundColor: theme.surface,
    borderRadius: 8,
    color: theme.text,
  },
  blocked: {
    textAlign: "center",
    fontWeight: "700",
    color: theme.warning,
    marginVertical: spacing.sm,
  },
  done: {
    textAlign: "center",
    fontWeight: "700",
    color: theme.success,
    marginBottom: spacing.sm,
  },
  hint: {
    marginBottom: spacing.sm,
    color: theme.textMuted,
    fontSize: typography.caption,
    fontWeight: "600",
  },
});
