import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import {
  useAttachBasket,
  usePickingSession,
  useReleaseOrderAccept,
} from "@/hooks/usePicking";
import { showErrorAlert } from "@/lib/app-alert";
import { ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

export default function BasketScanScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { data: session, isLoading } = usePickingSession(orderId);
  const attach = useAttachBasket(orderId);
  const releaseAccept = useReleaseOrderAccept(orderId);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRelease =
    session &&
    !session.order.basket &&
    session.items.every((i) => i.quantityPicked === 0);

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

  const handleReleaseAccept = async () => {
    try {
      await releaseAccept.mutateAsync();
      router.replace("/picking");
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao cancelar aceite",
      );
    }
  };

  return (
    <ScreenShell
      scroll
      title={session?.order.erpOrderId ?? "Separar pedido"}
      subtitle="Vincule uma cesta física ao pedido para iniciar o cronômetro"
    >
      {isLoading ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : null}

      {session ? (
        <>
          <Text style={styles.sectionTitle}>Itens a separar</Text>
          <View style={styles.itemsList}>
            {session.items.map((item) => (
              <View
                key={item.id}
                style={[styles.itemRow, item.completed && styles.itemDone]}
              >
                <ProductThumbnail
                  imageUrl={item.product.imageUrl}
                  alt={item.product.name}
                  size={56}
                />
                <View style={styles.itemInfo}>
                  <Text style={styles.itemSku}>{item.product.sku}</Text>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item.product.name}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {item.quantityOrdered} un.
                    {item.pickLocation?.label
                      ? ` · ${item.pickLocation.label}`
                      : ""}
                  </Text>
                  {item.completed ? (
                    <Text style={styles.itemDoneLabel}>Concluído</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

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

      {canRelease ? (
        <FactoryButton
          label="Cancelar aceite"
          variant="secondary"
          onPress={handleReleaseAccept}
          loading={releaseAccept.isPending}
        />
      ) : null}

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
  sectionTitle: {
    fontSize: typography.subtitle,
    fontWeight: "800",
    color: theme.text,
    marginBottom: spacing.sm,
  },
  itemsList: { gap: spacing.sm, marginBottom: spacing.md },
  itemRow: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: theme.surface,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  itemDone: { opacity: 0.65 },
  itemInfo: { flex: 1, gap: 2 },
  itemSku: { fontWeight: "800", color: theme.text },
  itemName: { color: theme.text, fontSize: typography.body },
  itemMeta: { color: theme.textMuted, fontSize: typography.caption },
  itemDoneLabel: {
    color: theme.success,
    fontWeight: "700",
    fontSize: typography.caption,
  },
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
