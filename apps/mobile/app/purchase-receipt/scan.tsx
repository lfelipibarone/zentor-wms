import { useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { useStartPurchaseReceipt } from "@/hooks/usePurchaseReceipt";
import { ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

export default function PurchaseReceiptScanScreen() {
  const [scannerOpen, setScannerOpen] = useState(true);
  const start = useStartPurchaseReceipt();

  const handleScan = async (barcode: string) => {
    setScannerOpen(false);
    try {
      const session = await start.mutateAsync(barcode);
      router.replace(`/purchase-receipt/${session.session.id}/check`);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : "Não foi possível abrir a nota";
      Alert.alert("Erro", msg, [
        { text: "Tentar de novo", onPress: () => setScannerOpen(true) },
        { text: "Voltar", onPress: () => router.replace("/") },
      ]);
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
        visible={scannerOpen && !start.isPending}
        title="DANFE — chave de acesso"
        hint="O código de barras da NF-e (44 dígitos)"
        onScan={handleScan}
        onClose={() => router.replace("/purchase-receipt")}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", padding: spacing.xl },
  loading: { marginTop: spacing.md, color: theme.textMuted },
});
