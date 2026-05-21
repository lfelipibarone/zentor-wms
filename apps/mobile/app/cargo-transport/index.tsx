import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import { api, ApiError } from "@/lib/api";
import type { LocationLookup, ReplenishmentNeed } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

type Phase = "list" | "scan-pulmao" | "confirm-qty" | "done";

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

export default function CargoTransportScreen() {
  const [phase, setPhase] = useState<Phase>("list");
  const [needs, setNeeds] = useState<ReplenishmentNeed[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selected, setSelected] = useState<ReplenishmentNeed | null>(null);
  const [pulmao, setPulmao] = useState<LocationLookup | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadNeeds = useCallback(async () => {
    setLoadingList(true);
    try {
      const data = await api.listReplenishmentNeeds();
      setNeeds(data.needs);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro ao carregar fila");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (phase === "list") loadNeeds();
    }, [phase, loadNeeds]),
  );

  const startNeed = (need: ReplenishmentNeed) => {
    setSelected(need);
    setPulmao(null);
    setPhase("scan-pulmao");
    setMessage(
      `Gôndola alvo: ${need.routeLabel} · repor ~${need.deficit} un.`,
    );
  };

  const handlePulmaoScan = async (raw: string) => {
    setScannerOpen(false);
    if (!selected) return;
    setLoading(true);
    setMessage(null);
    try {
      const loc = await api.getLocationByBarcode(normalizeBarcode(raw));
      if (loc.type !== "PULMAO") {
        setMessage("Bipe um pulmão (estoque de reserva)");
        return;
      }
      if (loc.product?.id && loc.product.id !== selected.productId) {
        setMessage("Produto do pulmão não corresponde à necessidade");
        return;
      }
      setPulmao(loc);
      setPhase("confirm-qty");
      setMessage(
        `${selected.sku} · máx. ${Math.min(loc.currentQuantity, selected.deficit)} un.`,
      );
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Pulmão não encontrado");
    } finally {
      setLoading(false);
    }
  };

  const confirmWithdraw = async (qty: number) => {
    if (!selected || !pulmao) return;
    const productCode =
      pulmao.product?.barcode ?? pulmao.product?.sku ?? selected.sku;
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.withdrawCargoTransfer({
        fromLocationBarcode: pulmao.barcode,
        productBarcode: productCode,
        quantity: qty,
        targetPickFaceId: selected.pickFaceId,
      });
      setMessage(
        `Retirado ${result.transfer.quantity} un. Vá em Abastecer estoque → gôndola ${selected.routeLabel}.`,
      );
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro no transporte");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setPhase("list");
    setSelected(null);
    setPulmao(null);
    setMessage(null);
    loadNeeds();
  };

  if (phase === "list") {
    return (
      <ScreenShell scroll backToHome>
        <Text style={styles.pageHint}>
          Fila de reabastecimento do estoque de giro. Retire do pulmão; depois
          deposite na gôndola em Abastecer estoque.
        </Text>

        {loadingList ? (
          <ActivityIndicator size="large" color={theme.primary} />
        ) : needs.length === 0 ? (
          <Text style={styles.empty}>Nenhuma gôndola abaixo do mínimo.</Text>
        ) : (
          <FlatList
            data={needs}
            keyExtractor={(n) => n.pickFaceId}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <Pressable style={styles.card} onPress={() => startNeed(item)}>
                <Text style={styles.badge}>REPOSIÇÃO · PULMÃO → GIRO</Text>
                <Text style={styles.sku}>{item.sku}</Text>
                <Text style={styles.name}>{item.productName}</Text>
                <Text style={styles.meta}>
                  Gôndola {item.routeLabel} · {item.currentQuantity}/
                  {item.minThreshold} un.
                </Text>
                <Text style={styles.deficit}>Repor ~{item.deficit} un.</Text>
                {item.suggestedPulmao ? (
                  <Text style={styles.pulmao}>
                    Pulmão: {item.suggestedPulmao.label} (
                    {item.suggestedPulmao.currentQuantity} un.)
                  </Text>
                ) : (
                  <Text style={styles.warn}>Sem pulmão com saldo</Text>
                )}
              </Pressable>
            )}
          />
        )}

        {message ? <Text style={styles.message}>{message}</Text> : null}
        <FactoryButton
          label="Atualizar fila"
          variant="secondary"
          onPress={loadNeeds}
        />
      </ScreenShell>
    );
  }

  const maxQty = pulmao
    ? Math.min(pulmao.currentQuantity, selected?.deficit ?? pulmao.currentQuantity)
    : 0;

  return (
    <ScreenShell scroll backToHome>
      {selected ? (
        <View style={styles.card}>
          <Text style={styles.badge}>Gôndola alvo</Text>
          <Text style={styles.locTitle}>{selected.routeLabel}</Text>
          <Text style={styles.meta}>
            {selected.sku} · repor ~{selected.deficit} un.
          </Text>
        </View>
      ) : null}

      {phase === "scan-pulmao" ? (
        <>
          <Text style={styles.instruction}>Bipe o pulmão de origem</Text>
          <FactoryButton
            label="Bipar pulmão"
            onPress={() => setScannerOpen(true)}
            loading={loading}
          />
          <FactoryButton
            label="Voltar à fila"
            variant="secondary"
            onPress={reset}
          />
        </>
      ) : null}

      {pulmao && phase === "confirm-qty" ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>PULMÃO</Text>
            <Text style={styles.locTitle}>{pulmao.label}</Text>
            <Text style={styles.meta}>Saldo: {pulmao.currentQuantity} un.</Text>
          </View>
          <Text style={styles.instruction}>Quantidade retirada</Text>
          <QuantityInput
            label={`Quantidade (máx. ${maxQty})`}
            max={maxQty}
            onConfirm={confirmWithdraw}
          />
        </>
      ) : null}

      {phase === "done" ? (
        <>
          <FactoryButton
            label="Abastecer estoque"
            onPress={() => router.push("/stocking")}
          />
          <FactoryButton
            label="Voltar à fila"
            variant="secondary"
            onPress={reset}
          />
        </>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <BarcodeScanner
        visible={scannerOpen}
        title="Bipar pulmão"
        onScan={handlePulmaoScan}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  pageHint: {
    fontSize: typography.body,
    color: theme.textMuted,
    marginBottom: spacing.md,
  },
  empty: { textAlign: "center", color: theme.textMuted, marginVertical: spacing.lg },
  instruction: {
    fontSize: typography.body,
    color: theme.textMuted,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: theme.primary,
  },
  badge: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.info,
    letterSpacing: 0.5,
  },
  sku: { fontWeight: "900", fontSize: typography.subtitle, color: theme.info },
  name: { color: theme.text, fontWeight: "600" },
  meta: { color: theme.textMuted, marginTop: spacing.xs },
  deficit: { color: theme.warning, fontWeight: "800", marginTop: spacing.sm },
  pulmao: { color: theme.textMuted, fontSize: typography.caption, marginTop: 4 },
  warn: { color: theme.danger, fontSize: typography.caption, marginTop: 4 },
  cardLabel: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.textMuted,
    letterSpacing: 1,
  },
  locTitle: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.primary,
  },
  message: {
    marginTop: spacing.md,
    color: theme.success,
    fontWeight: "700",
    textAlign: "center",
  },
});
