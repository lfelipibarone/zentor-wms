import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { useLookupLocation } from "@/hooks/useLookup";
import { theme, spacing, typography } from "@/lib/theme";

export default function LookupScreen() {
  const [barcode, setBarcode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const { data, isLoading, error, refetch } = useLookupLocation(barcode);

  return (
    <ScreenShell>
      <Text style={styles.subtitle}>
        Bipe qualquer gôndola para ver produto e estoque
      </Text>
      <FactoryButton
        label="Bipar gôndola"
        onPress={() => setScannerOpen(true)}
      />

      {barcode && !data && isLoading ? (
        <Text style={styles.loading}>Consultando...</Text>
      ) : null}

      {error ? (
        <Text style={styles.error}>
          {error instanceof Error ? error.message : "Não encontrado"}
        </Text>
      ) : null}

      {data ? (
        <View style={styles.result}>
          <Text style={styles.location}>{data.label}</Text>
          <Text style={styles.barcode}>{data.barcode}</Text>

          {data.product ? (
            <>
              <Text style={styles.divider}>— PRODUTO —</Text>
              <Text style={styles.sku}>{data.product.sku}</Text>
              <Text style={styles.name}>{data.product.name}</Text>
            </>
          ) : (
            <Text style={styles.empty}>Gôndola vazia / sem alocação</Text>
          )}

          <View style={styles.qtyBox}>
            <Text style={styles.qtyLabel}>QUANTIDADE</Text>
            <Text style={styles.qtyValue}>{data.currentQuantity}</Text>
            <Text style={styles.qtySub}>
              Cap: {data.capacity} · Mín: {data.minThreshold}
            </Text>
          </View>

          {data.needsReplenishment ? (
            <Text style={styles.alert}>⚠ Abaixo do mínimo — reabastecer</Text>
          ) : null}
        </View>
      ) : null}

      {barcode ? (
        <FactoryButton
          label="Nova consulta"
          variant="secondary"
          onPress={() => {
            setBarcode(null);
            refetch();
          }}
        />
      ) : null}

      <BarcodeScanner
        visible={scannerOpen}
        title="Consultar gôndola"
        onScan={(code) => {
          setScannerOpen(false);
          setBarcode(code);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    color: theme.textMuted,
    fontSize: typography.body,
    marginBottom: spacing.sm,
  },
  loading: { color: theme.textMuted, fontSize: typography.body },
  error: { color: theme.danger, fontWeight: "700", fontSize: typography.body },
  result: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 3,
    borderColor: theme.primary,
  },
  location: {
    fontSize: 36,
    fontWeight: "900",
    color: theme.primary,
    textAlign: "center",
  },
  barcode: {
    textAlign: "center",
    color: theme.textMuted,
    fontSize: typography.body,
  },
  divider: {
    textAlign: "center",
    color: theme.textMuted,
    marginTop: spacing.md,
    fontWeight: "800",
    letterSpacing: 2,
  },
  sku: { fontSize: typography.body, color: theme.info, fontWeight: "800" },
  name: {
    fontSize: typography.subtitle,
    color: theme.text,
    fontWeight: "700",
    textAlign: "center",
  },
  empty: { color: theme.warning, textAlign: "center", fontSize: typography.body },
  qtyBox: {
    marginTop: spacing.lg,
    backgroundColor: theme.bg,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: "center",
  },
  qtyLabel: {
    color: theme.textMuted,
    fontWeight: "800",
    letterSpacing: 2,
    fontSize: typography.caption,
  },
  qtyValue: {
    fontSize: 64,
    fontWeight: "900",
    color: theme.success,
  },
  qtySub: { color: theme.textMuted, fontSize: typography.caption },
  alert: {
    color: theme.warning,
    fontWeight: "800",
    textAlign: "center",
    fontSize: typography.body,
    marginTop: spacing.sm,
  },
});
