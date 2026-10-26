import { useCallback, useRef, useState } from "react";
import { router, useLocalSearchParams, usePreventRemove } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { OrderStatus } from "@wms/shared";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import { Badge, Card, Loading, Notice, SectionTitle } from "@/components/ui";
import { modules } from "@/lib/modules";
import {
  useAttachBasket,
  usePickingSession,
  useReleaseOrderAccept,
} from "@/hooks/usePicking";
import { showErrorAlert } from "@/lib/app-alert";
import { ApiError, type PickLocationDto } from "@/lib/api";
import { theme, spacing, typography, radius } from "@/lib/theme";

function locationLabel(loc: PickLocationDto | null | undefined): string | null {
  if (!loc) return null;
  return loc.label || loc.barcode || `${loc.corridor}-${loc.row}` || null;
}

export default function BasketScanScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { data: session, isLoading } = usePickingSession(orderId);
  const attach = useAttachBasket(orderId);
  const releaseAccept = useReleaseOrderAccept(orderId);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowLeave, setAllowLeave] = useState(false);
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

  const disablePrevention = usePreventRemove(
    Boolean(canRelease) && !allowLeave,
    ({ repeat }) => {
      if (releasingRef.current) return;
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
                  setAllowLeave(true);
                  repeat();
                }
              })();
            },
          },
        ],
      );
    },
  );

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
      setAllowLeave(true);
      disablePrevention();
      router.replace("/picking");
    }
  };

  const units = session?.items.reduce((n, i) => n + i.quantityOrdered, 0) ?? 0;
  const pendingItems = session?.items.filter((i) => !i.completed) ?? [];
  const nextLoc = pendingItems.find((i) => i.pickLocation)?.pickLocation ?? null;
  const nextLocLabel = locationLabel(nextLoc);
  const laterLocs = pendingItems
    .map((i) => locationLabel(i.pickLocation))
    .filter((label): label is string => Boolean(label) && label !== nextLocLabel)
    .filter((label, idx, arr) => arr.indexOf(label) === idx)
    .slice(0, 3);

  return (
    <ScreenShell
      scroll
      module="picking"
      title={session?.order.erpOrderId ?? "Pedido"}
      subtitle={session ? `${session.items.length} itens · ${units} un.` : null}
    >
      {isLoading ? <Loading /> : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {nextLocLabel ? (
        <View style={styles.locationCard}>
          <Text style={styles.locLabel}>Vá até</Text>
          <Text style={styles.locValue} adjustsFontSizeToFit numberOfLines={1}>
            {nextLocLabel}
          </Text>
          {laterLocs.length > 0 ? (
            <Text style={styles.routeNext} numberOfLines={1}>
              Depois: {laterLocs.join(" → ")}
            </Text>
          ) : null}
        </View>
      ) : session && pendingItems.length > 0 ? (
        <Notice tone="warning">Itens sem endereço de gôndola</Notice>
      ) : null}

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
          {session.items.map((item) => {
            const loc = locationLabel(item.pickLocation);
            return (
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
                    {loc ? (
                      <Badge label={loc} icon="navigate" tone="info" />
                    ) : (
                      <Text style={styles.itemLocMissing}>Sem endereço</Text>
                    )}
                  </View>
                  <Text style={styles.itemQty}>{item.quantityOrdered}</Text>
                </View>
              </Card>
            );
          })}
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

const color = modules.picking.color;

const styles = StyleSheet.create({
  locationCard: {
    backgroundColor: color,
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  locLabel: {
    fontSize: typography.caption,
    fontWeight: "900",
    color: "rgba(255,255,255,0.85)",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  locValue: {
    fontSize: 44,
    fontWeight: "900",
    color: "#fff",
    textAlign: "center",
  },
  routeNext: {
    color: "rgba(255,255,255,0.8)",
    fontWeight: "700",
    fontSize: typography.caption,
    marginTop: spacing.sm,
  },
  itemRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  itemInfo: { flex: 1, gap: 4 },
  itemSku: { fontWeight: "900", color: theme.info },
  itemName: { color: theme.text, fontWeight: "600" },
  itemLocMissing: {
    color: theme.warning,
    fontWeight: "800",
    fontSize: typography.caption,
  },
  itemQty: { fontSize: 26, fontWeight: "900", color: theme.text },
});
