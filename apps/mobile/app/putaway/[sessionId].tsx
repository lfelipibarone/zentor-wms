import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import {
  useCompletePutaway,
  usePutawaySession,
  useStorePutawayItem,
} from "@/hooks/usePutaway";
import { ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

type Phase = "scan-location" | "confirm-qty";

export default function PutawaySessionScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { data, isLoading } = usePutawaySession(sessionId);
  const store = useStorePutawayItem(sessionId ?? "");
  const complete = useCompletePutaway(sessionId ?? "");
  const [phase, setPhase] = useState<Phase>("scan-location");
  const [locationBarcode, setLocationBarcode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const next = data?.nextItem;

  useEffect(() => {
    setPhase("scan-location");
    setLocationBarcode(null);
  }, [next?.id]);

  const handleLocationScan = (code: string) => {
    setScannerOpen(false);
    setLocationBarcode(code.trim());
    setPhase("confirm-qty");
    setFeedback(`Local ${code.trim()} — informe a quantidade`);
  };

  const handleConfirmQty = async (qty: number) => {
    if (!next || !locationBarcode) return;
    try {
      const updated = await store.mutateAsync({
        itemId: next.id,
        locationBarcode,
        quantity: qty,
      });
      setLocationBarcode(null);
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

      {data.allStored ? (
        <FactoryButton
          label="Finalizar armazenagem"
          onPress={handleComplete}
        />
      ) : (
        <>
          {phase === "scan-location" ? (
            <>
              <Text style={styles.hint}>1. Bipe o local de pulmão</Text>
              <FactoryButton
                label="Bipar local"
                onPress={() => setScannerOpen(true)}
              />
            </>
          ) : next ? (
            <>
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
                  setLocationBarcode(null);
                }}
              />
            </>
          ) : null}
        </>
      )}

      <BarcodeScanner
        visible={scannerOpen}
        title="Bipar local de pulmão"
        onScan={handleLocationScan}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
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
  },
});
