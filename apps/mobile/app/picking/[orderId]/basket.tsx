import { useCallback, useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { OrderStatus } from "@wms/shared";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import { Card, Loading, Notice, SectionTitle } from "@/components/ui";
import { modules } from "@/lib/modules";
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
  const navigation = useNavigation();
  const { data: session, isLoading } = usePickingSession(orderId);
  const attach = useAttachBasket(orderId);
  const releaseAccept = useReleaseOrderAccept(orderId);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const releasingRef = useRef(false);

  const canRelease =
    session &&
    !session.order.basket &&
    session.items.every((i) => i.quantityPicked === 0) &&
    session.order.status === OrderStatus.PICKING;

  const handleReleaseAccept = useCallback(async () => {
    if (releasingRef.current) return false;
    releasingRef.current = true;
    try {
      await releaseAccept.mutateAsync();
      return true;
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao cancelar aceite",
      );
      return false;
    } finally {
      releasingRef.current = false;
    }
  }, [releaseAccept]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!canRelease || releasingRef.current) return;
      e.preventDefault();
      Alert.alert(
        "Sair sem cesta?",
        "O pedido voltará para a fila de separação.",
        [
          { text: "Continuar", style: "cancel" },
          {
            text: "Voltar à fila",
            style: "destructive",
            onPress: () => {
              void (async () => {
                const released = await handleReleaseAccept();
                if (released) {
                  navigation.dispatch(e.data.action);
                }
              })();
            },
          },
        ],
      );
    });
    return unsubscribe;
  }, [canRelease, handleReleaseAccept, navigation]);

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

  const handleReleaseAcceptPress = async () => {
    const released = await handleReleaseAccept();
    if (released) {
      router.replace("/picking");
    }
  };

  const units = session?.items.reduce((n, i) => n + i.quantityOrdered, 0) ?? 0;

  return (
    <ScreenShell
      scroll
      module="picking"
      title={session?.order.erpOrderId ?? "Pedido"}
      subtitle={session ? `${session.items.length} itens · ${units} un.` : null}
    >
      {isLoading ? <Loading /> : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <FactoryButton
        label="Bipar cesta"
        icon="basket"
        color={modules.picking.color}
        onPress={() => setScannerOpen(true)}
        loading={attach.isPending}
      />

      {session ? (
        <>
          <SectionTitle>Itens</SectionTitle>
          {session.items.map((item) => (
            <Card key={item.id} muted={item.completed}>
              <View style={styles.itemRow}>
                <ProductThumbnail
                  imageUrl={item.product?.imageUrl}
                  alt={item.product?.name ?? "Produto"}
                  size={52}
                />
                <View style={styles.itemInfo}>
                  <Text style={styles.itemSku}>
                    {item.product?.sku ?? "SKU indisponível"}
                  </Text>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.product?.name ?? "Produto não encontrado"}
                  </Text>
                  {item.pickLocation?.label ? (
                    <Text style={styles.itemLoc}>{item.pickLocation.label}</Text>
                  ) : null}
                </View>
                <Text style={styles.itemQty}>{item.quantityOrdered}</Text>
              </View>
            </Card>
          ))}
        </>
      ) : null}

      {canRelease ? (
        <FactoryButton
          label="Cancelar aceite"
          icon="close"
          size="sm"
          variant="ghost"
          onPress={handleReleaseAcceptPress}
          loading={releaseAccept.isPending}
        />
      ) : null}

      <BarcodeScanner
        visible={scannerOpen}
        title="Bipar cesta"
        onScan={handleScan}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  itemRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  itemInfo: { flex: 1, gap: 1 },
  itemSku: { fontWeight: "900", color: theme.info },
  itemName: { color: theme.text, fontWeight: "600" },
  itemLoc: { color: theme.textMuted, fontWeight: "800", fontSize: typography.caption },
  itemQty: { fontSize: 26, fontWeight: "900", color: theme.text },
});
