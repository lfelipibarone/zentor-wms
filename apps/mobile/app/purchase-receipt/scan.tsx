import { useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { SplitWorkModal } from "@/components/SplitWorkModal";
import { useStartPurchaseReceipt } from "@/hooks/usePurchaseReceipt";
import { useSplitWork } from "@/hooks/useWorkShares";
import { ApiError, type PurchaseReceiptSessionDto } from "@/lib/api";
import { theme, spacing } from "@/lib/theme";

export default function PurchaseReceiptScanScreen() {
  const [scannerOpen, setScannerOpen] = useState(true);
  const [toSplit, setToSplit] = useState<PurchaseReceiptSessionDto | null>(null);
  const start = useStartPurchaseReceipt();
  const splitWork = useSplitWork();

  const openCheck = (sessionId: string) => router.replace(`/purchase-receipt/${sessionId}/check`);

  const handleScan = async (barcode: string) => {
    setScannerOpen(false);
    try {
      const session = await start.mutateAsync(barcode);
      const shares = session.work?.shares ?? [];
      const pendingItems = session.items.filter((it) => !it.completed).length;
      if (shares.length === 0 && pendingItems > 0) {
        setToSplit(session);
        return;
      }
      if (shares.length > 0 && !session.work?.mine) {
        const names = shares.map((s) => s.assignedTo.name).join(", ");
        Alert.alert("NF já dividida", `Esta NF está com: ${names}.`, [
          { text: "Voltar", onPress: () => router.replace("/purchase-receipt") },
        ]);
        return;
      }
      openCheck(session.session.id);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Não foi possível abrir a nota";
      Alert.alert("Erro", msg, [
        { text: "Tentar de novo", onPress: () => setScannerOpen(true) },
        { text: "Voltar", onPress: () => router.replace("/") },
      ]);
    }
  };

  const handleSplit = async (colleagueIds: string[]) => {
    if (!toSplit) return;
    try {
      await splitWork.mutateAsync({
        kind: "RECEIPT_CHECK",
        refId: toSplit.session.id,
        colleagueIds,
      });
      const sessionId = toSplit.session.id;
      setToSplit(null);
      openCheck(sessionId);
    } catch (e) {
      Alert.alert(
        "Erro",
        e instanceof ApiError ? e.message : "Não foi possível dividir a conferência",
      );
    }
  };

  return (
    <ScreenShell
      backToHome
      scroll
      title="Bipar DANFE"
      subtitle="Aponte para o código de barras da chave de acesso na DANFE"
    >
      {start.isPending ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loading}>Buscando nota no Tiny…</Text>
        </View>
      ) : (
        <FactoryButton
          label="Abrir câmera"
          onPress={() => setScannerOpen(true)}
        />
      )}

      <BarcodeScanner
        visible={scannerOpen && !start.isPending && !toSplit}
        title="DANFE — chave de acesso"
        hint="O código de barras da NF-e (44 dígitos)"
        onScan={handleScan}
        onClose={() => router.replace("/purchase-receipt")}
      />

      <SplitWorkModal
        visible={Boolean(toSplit)}
        title={`Conferir NF ${toSplit?.session.invoiceNumber ?? ""}`}
        subtitle={toSplit?.session.supplierName}
        itemCount={toSplit?.items.filter((it) => !it.completed).length}
        loading={splitWork.isPending}
        onCancel={() => {
          setToSplit(null);
          router.replace("/purchase-receipt");
        }}
        onConfirm={handleSplit}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", padding: spacing.xl },
  loading: { marginTop: spacing.md, color: theme.textMuted },
});
