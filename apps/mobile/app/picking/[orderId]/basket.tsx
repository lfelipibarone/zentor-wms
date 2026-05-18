import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { useAttachBasket } from "@/hooks/usePicking";
import { ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

export default function BasketScanScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const attach = useAttachBasket(orderId);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScan = async (barcode: string) => {
    setScannerOpen(false);
    setError(null);
    try {
      const result = await attach.mutateAsync(barcode);
      router.replace({
        pathname: "/picking/[orderId]/pick",
        params: { orderId, basketCode: result.basketCode },
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Cesta inválida");
    }
  };

  return (
    <ScreenShell subtitle="Vincule uma cesta física ao pedido para iniciar o cronômetro">
      <View style={styles.infoBox}>
        <Text style={styles.info}>
          Aponte a câmera para o código de barras da cesta de separação.
          O tempo de separação será registrado automaticamente.
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FactoryButton
        label="Abrir leitor"
        onPress={() => setScannerOpen(true)}
        loading={attach.isPending}
      />

      <BarcodeScanner
        visible={scannerOpen}
        title="Código da cesta"
        hint="Bipe o barcode da cesta (Basket)"
        onScan={handleScan}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  infoBox: {
    backgroundColor: theme.surface,
    padding: spacing.lg,
    borderRadius: 12,
    borderLeftWidth: 6,
    borderLeftColor: theme.primary,
  },
  info: { fontSize: typography.body, color: theme.text, lineHeight: 26 },
  error: {
    color: theme.danger,
    fontSize: typography.body,
    fontWeight: "700",
  },
});
