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
import {
  PulmaoWithdrawPercent,
  type PulmaoWithdrawResult,
} from "@/components/PulmaoWithdrawPercent";
import { ScreenShell } from "@/components/ScreenShell";
import { api, ApiError } from "@/lib/api";
import type { LocationLookup, ReplenishmentNeed } from "@/lib/api";
import { pulmaoPercentOf, pulmaoStocksSummary } from "@/lib/pulmao";
import { theme, spacing, typography } from "@/lib/theme";

type Phase = "list" | "scan-pulmao" | "confirm-pct" | "done";

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
      `Gôndola alvo: ${need.routeLabel} · está em ${need.fillPercent}% (mín. ${need.minPercent}%)`,
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
      const available = pulmaoPercentOf(loc, selected.productId);
      if (available <= 0) {
        setMessage(`Pulmão ${loc.barcode} não tem ${selected.sku} (${pulmaoStocksSummary(loc)})`);
        return;
      }
      setPulmao(loc);
      setPhase("confirm-pct");
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Pulmão não encontrado");
    } finally {
      setLoading(false);
    }
  };

  const confirmWithdraw = async ({ remainingPercent, skuFinished }: PulmaoWithdrawResult) => {
    if (!selected || !pulmao) return;
    const productCode = selected.sku;
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.withdrawCargoTransfer({
        fromLocationBarcode: pulmao.barcode,
        productBarcode: productCode,
        remainingPercent,
        skuFinished,
        targetPickFaceId: selected.pickFaceId,
      });
      setMessage(
        `${
          result.fromLocation.skuPercent === 0
            ? `${productCode} saiu do pulmão ${result.fromLocation.barcode}.`
            : `${productCode} ficou com ${result.fromLocation.skuPercent}% no pulmão.`
        } Vá em Abastecer estoque → gôndola ${selected.routeLabel}.`,
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
                  Gôndola {item.routeLabel} · {item.fillPercent}% (mín.{" "}
                  {item.minPercent}%)
                </Text>
                <Text style={styles.deficit}>Falta {item.percentToFill}% para encher</Text>
                {item.suggestedPulmao ? (
                  <Text style={styles.pulmao}>
                    Pulmão: {item.suggestedPulmao.label} ({item.suggestedPulmao.percent}%
                    deste SKU)
                  </Text>
                ) : (
                  <Text style={styles.warn}>Sem pulmão com este SKU</Text>
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

  const pulmaoPct = pulmao && selected ? pulmaoPercentOf(pulmao, selected.productId) : 0;

  return (
    <ScreenShell scroll backToHome>
      {selected ? (
        <View style={styles.card}>
          <Text style={styles.badge}>Gôndola alvo</Text>
          <Text style={styles.locTitle}>{selected.routeLabel}</Text>
          <Text style={styles.meta}>
            {selected.sku} · gôndola em {selected.fillPercent}%
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

      {pulmao && selected && phase === "confirm-pct" ? (
        <>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>PULMÃO</Text>
            <Text style={styles.locTitle}>{pulmao.label}</Text>
          </View>
          <PulmaoWithdrawPercent
            sku={selected.sku}
            pulmaoLabel={pulmao.label}
            currentPercent={pulmaoPct}
            loading={loading}
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
