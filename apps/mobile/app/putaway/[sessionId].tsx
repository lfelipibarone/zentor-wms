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
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import {
  useCompletePutaway,
  usePutawaySession,
  useStorePutawayItem,
} from "@/hooks/usePutaway";
import { ApiError, type LocationLookup } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

type Phase = "scan-location" | "confirm-qty";

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

  const next = data?.nextItem;

  useEffect(() => {
    setPhase("scan-location");
    setSelectedLocation(null);
  }, [next?.id]);

  const handleLocationSelect = (loc: LocationLookup) => {
    setSelectedLocation(loc);
    setPhase("confirm-qty");
    setFeedback(`Local ${loc.label} — informe a quantidade`);
  };

  const handleConfirmQty = async (qty: number) => {
    if (!next || !selectedLocation) return;
    try {
      const updated = await store.mutateAsync({
        itemId: next.id,
        locationBarcode: selectedLocation.barcode,
        quantity: qty,
      });
      setSelectedLocation(null);
      setPhase("scan-location");
      if (updated.allStored) {
        setFeedback("Todos os itens armazenados ✓");
      } else if (updated.nextItem) {
        setFeedback(
          `Próximo: ${updated.nextItem.description ?? updated.nextItem.productCode}`,
        );
      }
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Erro ao armazenar");
    }
  };

  const handleComplete = async () => {
    try {
      await complete.mutateAsync();
      Alert.alert("Armazenagem concluída", "Itens endereçados no pulmão.", [
        { text: "OK", onPress: () => router.replace("/putaway") },
      ]);
    } catch (e) {
      Alert.alert(
        "Erro",
        e instanceof ApiError ? e.message : "Não foi possível finalizar",
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

      {next && !data.allStored ? (
        <View style={styles.productRow}>
          <ProductThumbnail
            imageUrl={next.imageUrl}
            label={next.description ?? next.productCode ?? ""}
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
          </View>
        </View>
      ) : null}

      {data.allStored ? (
        <FactoryButton
          label="Finalizar armazenagem"
          onPress={handleComplete}
        />
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
                <Text style={styles.locMeta}>
                  Saldo: {selectedLocation.currentQuantity} / cap.{" "}
                  {selectedLocation.capacity}
                </Text>
              </View>
              <Text style={styles.hint}>
                2. Quantidade para {next.description ?? next.productCode}
              </Text>
              <QuantityInput
                label="Unidades a armazenar"
                max={next.remaining}
                loading={store.isPending}
                onConfirm={handleConfirmQty}
              />
              <FactoryButton
                label="Trocar local"
                variant="secondary"
                onPress={() => {
                  setPhase("scan-location");
                  setSelectedLocation(null);
                }}
              />
            </>
          ) : null}
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
  hint: {
    marginBottom: spacing.sm,
    color: theme.textMuted,
    fontSize: typography.caption,
    fontWeight: "600",
  },
});
