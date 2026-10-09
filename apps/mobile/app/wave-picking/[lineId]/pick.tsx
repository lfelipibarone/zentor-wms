import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  AdjustStockModal,
  type AdjustStockContext,
} from "@/components/AdjustStockModal";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { CollectionDeadlineRow } from "@/components/CollectionDeadlineRow";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import { Badge, Card, Loading, Notice, SectionTitle } from "@/components/ui";
import { useAdjustLocationStock } from "@/hooks/useAdjustLocationStock";
import { useWaveLine, useWaveLinePick } from "@/hooks/useWavePicking";
import { showErrorAlert, showToast } from "@/lib/app-alert";
import { ApiError } from "@/lib/api";
import { modules } from "@/lib/modules";
import { formatLevel, formatMinLevel, isQuantityMode } from "@/lib/percent";
import type { GondolaLevel } from "@/components/PercentInput";
import { theme, spacing, typography, radius } from "@/lib/theme";

export default function WavePickScreen() {
  const { lineId } = useLocalSearchParams<{ lineId: string }>();
  const { data, isLoading, refetch } = useWaveLine(lineId);
  const pick = useWaveLinePick(lineId);
  const adjustStock = useAdjustLocationStock();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<"location" | "product">(
    "location",
  );
  const [locationOk, setLocationOk] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  /** Coleta da linha concluída: o separador precisa informar a % da gôndola */
  const [afterPickOpen, setAfterPickOpen] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const say = (text: string, error = false) => setMessage({ text, error });

  const line = data?.line;

  if (isLoading || !line) {
    return (
      <ScreenShell module="picking" title="Onda">
        <Loading />
      </ScreenShell>
    );
  }

  const maxPick = line.remaining;

  const adjustContext: AdjustStockContext = {
    locationId: line.pickLocation.id,
    locationLabel: line.pickLocation.label,
    currentPercent: line.pickLocation.fillPercent,
    level: line.pickLocation,
    productBarcode: line.product.barcode,
    productName: line.product.name,
    waveLineId: lineId,
  };

  const handleAdjustStock = async (level: GondolaLevel, reason: string) => {
    try {
      const result = await adjustStock.mutateAsync({
        locationId: line.pickLocation.id,
        ...level,
        productBarcode: line.product.barcode,
        reason,
        waveLineId: lineId,
      });
      setAdjustOpen(false);
      say(`Gôndola ajustada: ${formatLevel(result.location)}`);

      const waveUpdate = result.reconciliation.waveLines.find(
        (w) => w.waveLineId === lineId,
      );
      if (waveUpdate?.newLocationBarcode && waveUpdate.action === "updated") {
        say(`Gôndola atualizada: ${waveUpdate.newLocationBarcode}`);
        setLocationOk(false);
      }

      if (result.reconciliation.warnings.length > 0) {
        Alert.alert(
          "Avisos",
          result.reconciliation.warnings.slice(0, 4).join("\n"),
        );
      }

      await refetch();
    } catch (e) {
      say(e instanceof ApiError ? e.message : "Erro ao ajustar estoque", true);
    }
  };

  const confirmPick = async (qty: number, productBarcode?: string) => {
    try {
      const result = await pick.mutateAsync({
        locationBarcode: line.pickLocation.barcode,
        productBarcode,
        quantity: qty,
      });
      say(
        `Pick registrado: ${result.quantityPicked}/${result.quantityTotal}`,
      );
      if (result.readyForSort) {
        if (isQuantityMode(result.location)) {
          showToast(`Pick concluído · gôndola com ${formatLevel(result.location)}`);
          router.replace("/picking");
          return;
        }
        say("Pick concluído — informe a % que ficou na gôndola.");
        setAfterPickOpen(true);
      }
    } catch (e) {
      say(e instanceof ApiError ? e.message : "Erro no pick", true);
    }
  };

  const handleAfterPickPercent = async (level: GondolaLevel, reason: string) => {
    try {
      await adjustStock.mutateAsync({
        locationId: line.pickLocation.id,
        ...level,
        productBarcode: line.product.barcode,
        reason,
        waveLineId: lineId,
      });
      setAfterPickOpen(false);
      router.replace("/picking");
    } catch (e) {
      showErrorAlert(e instanceof ApiError ? e.message : "Erro ao salvar a % da gôndola");
    }
  };

  const picked = line.sortStatus === "PICKED";
  return (
    <ScreenShell
      scroll
      module="picking"
      title={line.product.sku}
      subtitle={`${line.ordersCount} pedidos`}
    >
      <View style={styles.locationCard}>
        <Text style={styles.locLabel}>Vá até</Text>
        <Text style={styles.locValue} adjustsFontSizeToFit numberOfLines={1}>
          {line.pickLocation.label}
        </Text>
        <Text style={styles.locStock}>
          Gôndola {formatLevel(line.pickLocation)}
          {formatMinLevel(line.pickLocation) ? ` · mín. ${formatMinLevel(line.pickLocation)}` : ""}
        </Text>
        {locationOk ? (
          <View style={styles.locOk}>
            <Ionicons name="checkmark-circle" size={18} color="#fff" />
            <Text style={styles.locOkText}>Confirmada</Text>
          </View>
        ) : null}
      </View>

      <Card>
        <View style={styles.productRow}>
          <ProductThumbnail imageUrl={line.product.imageUrl} alt={line.product.name} size={84} />
          <View style={styles.productInfo}>
            <Text style={styles.sku}>{line.product.sku}</Text>
            <Text style={styles.name} numberOfLines={3}>
              {line.product.name}
            </Text>
            <CollectionDeadlineRow deadline={line.collectionDeadline} compact />
          </View>
          <View style={styles.qtyBox}>
            <Text style={styles.qtyValue}>{line.remaining}</Text>
            <Text style={styles.qtyLabel}>un.</Text>
          </View>
        </View>
      </Card>

      {message ? (
        <Notice tone={message.error ? "danger" : "success"}>{message.text}</Notice>
      ) : null}

      {picked ? (
        <FactoryButton
          label="Informar % da gôndola"
          icon="speedometer"
          onPress={() => setAfterPickOpen(true)}
        />
      ) : !locationOk ? (
        <FactoryButton
          label="Bipar gôndola"
          icon="scan"
          color={modules.picking.color}
          onPress={() => {
            setScannerMode("location");
            setScannerOpen(true);
          }}
        />
      ) : (
        <>
          <QuantityInput
            label="Quantidade coletada"
            max={maxPick}
            loading={pick.isPending}
            onConfirm={(q) => confirmPick(q, line.product.barcode ?? undefined)}
          />
          <FactoryButton
            label="Bipar produto (+1)"
            icon="barcode"
            size="md"
            variant="secondary"
            disabled={maxPick <= 0}
            onPress={() => {
              setScannerMode("product");
              setScannerOpen(true);
            }}
          />
        </>
      )}

      <FactoryButton
        label="Corrigir % da gôndola"
        icon="speedometer"
        size="sm"
        variant="secondary"
        onPress={() => setAdjustOpen(true)}
      />

      <SectionTitle>Pedidos</SectionTitle>
      <View style={styles.orders}>
        {line.orders.map((o) => (
          <View key={o.orderId} style={styles.orderRow}>
            <Text style={styles.orderErp} numberOfLines={1}>
              {o.erpOrderId}
            </Text>
            {o.basketCode ? <Badge label={o.basketCode} icon="basket" /> : null}
            <Text style={styles.orderQty}>{o.quantity} un.</Text>
          </View>
        ))}
      </View>

      <BarcodeScanner
        visible={scannerOpen}
        title={
          scannerMode === "location"
            ? `Gôndola ${line.pickLocation.label}`
            : line.product.sku
        }
        onScan={(code) => {
          setScannerOpen(false);
          if (scannerMode === "location") {
            if (code.trim().toUpperCase() === line.pickLocation.barcode.toUpperCase()) {
              setLocationOk(true);
              say("Gôndola confirmada ✓");
            } else {
              say("Gôndola incorreta", true);
            }
          } else {
            void confirmPick(1, code);
          }
        }}
        onClose={() => setScannerOpen(false)}
      />

      <AdjustStockModal
        visible={adjustOpen}
        loading={adjustStock.isPending}
        context={adjustContext}
        onSubmit={handleAdjustStock}
        onClose={() => setAdjustOpen(false)}
      />
      <AdjustStockModal
        visible={afterPickOpen}
        mode="after-pick"
        loading={adjustStock.isPending}
        context={adjustContext}
        onSubmit={handleAfterPickPercent}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  locationCard: {
    backgroundColor: modules.picking.color,
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
  locValue: { fontSize: 44, fontWeight: "900", color: "#fff", textAlign: "center" },
  locStock: { color: "#fff", fontWeight: "800", marginTop: spacing.xs },
  locOk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  locOkText: { color: "#fff", fontWeight: "900" },
  productRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  productInfo: { flex: 1, gap: 4 },
  sku: { fontWeight: "900", fontSize: typography.body, color: theme.info },
  name: { fontSize: typography.caption + 1, fontWeight: "700", color: theme.text },
  qtyBox: {
    minWidth: 64,
    alignItems: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: modules.picking.soft,
  },
  qtyValue: { fontSize: 34, fontWeight: "900", color: "#0F766E" },
  qtyLabel: { fontSize: typography.small, fontWeight: "800", color: "#0F766E" },
  orders: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
  },
  orderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  orderErp: { flex: 1, fontWeight: "800", color: theme.text },
  orderQty: { fontWeight: "900", color: theme.text },
});
