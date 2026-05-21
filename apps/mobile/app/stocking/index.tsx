import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import { api, ApiError } from "@/lib/api";
import type { CargoTransferSummary } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

type Phase = "list" | "scan-gondola" | "confirm-qty" | "done";

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

function formatAgo(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

export default function StockingScreen() {
  const [phase, setPhase] = useState<Phase>("list");
  const [transfers, setTransfers] = useState<CargoTransferSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selected, setSelected] = useState<CargoTransferSummary | null>(null);
  const [toBarcode, setToBarcode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    setLoadingList(true);
    try {
      const data = await api.listPendingCargoTransfers();
      setTransfers(data.transfers);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro ao carregar");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (phase === "list") loadPending();
    }, [phase, loadPending]),
  );

  const openTransfer = async (t: CargoTransferSummary) => {
    setSelected(t);
    setToBarcode(null);
    setPhase("scan-gondola");
    if (t.targetPickFace) {
      setMessage(
        `${t.product.sku} · ${t.quantity} un. · Bipe a gôndola ${t.targetPickFace.label}`,
      );
    } else {
      setMessage(
        `${t.product.sku} · ${t.quantity} un. do ${t.fromLocation.label}`,
      );
      try {
        const { suggested } = await api.suggestCargoTransferFace(t.id);
        setMessage(
          `Sugestão: gôndola ${suggested.label} — bip obrigatório`,
        );
      } catch {
        /* operador bipa manualmente */
      }
    }
  };

  const handleGondolaScan = async (raw: string) => {
    setScannerOpen(false);
    if (!selected) return;
    setLoading(true);
    setMessage(null);
    try {
      const loc = await api.getLocationByBarcode(normalizeBarcode(raw));
      if (loc.type !== "PICK_FACE") {
        setMessage("Bipe um endereço de estoque de giro");
        return;
      }
      setToBarcode(loc.barcode);
      setPhase("confirm-qty");
      setMessage(`Gôndola ${loc.label}. Confirme ${selected.quantity} un.`);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Gôndola não encontrada");
    } finally {
      setLoading(false);
    }
  };

  const confirmDeposit = async () => {
    if (!selected || !toBarcode) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.depositCargoTransfer(selected.id, {
        toLocationBarcode: toBarcode,
        productBarcode: selected.product.barcode ?? selected.product.sku,
        quantity: selected.quantity,
      });
      setMessage(
        `Abastecido ${result.transfer.quantity} un. na gôndola (saldo: ${result.toLocation.currentQuantity})`,
      );
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro ao abastecer");
    } finally {
      setLoading(false);
    }
  };

  const backToList = () => {
    setPhase("list");
    setSelected(null);
    setToBarcode(null);
    setMessage(null);
    loadPending();
  };

  if (phase === "list") {
    return (
      <ScreenShell scroll backToHome>
        <Text style={styles.pageHint}>
          Itens retirados do pulmão aguardando gôndola. Bipe sempre a gôndola de
          destino antes de confirmar.
        </Text>

        {loadingList ? (
          <ActivityIndicator size="large" color={theme.primary} />
        ) : transfers.length === 0 ? (
          <Text style={styles.empty}>
            Nenhum transporte em trânsito. Use Transporte de carga no menu.
          </Text>
        ) : (
          <FlatList
            data={transfers}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <Pressable style={styles.card} onPress={() => openTransfer(item)}>
                <Text style={styles.cardTitle}>{item.product.sku}</Text>
                <Text style={styles.meta}>{item.product.name}</Text>
                <Text style={styles.meta}>
                  {item.quantity} un. · de {item.fromLocation.label}
                </Text>
                {item.targetPickFace ? (
                  <Text style={styles.target}>
                    Gôndola alvo: {item.targetPickFace.label}
                  </Text>
                ) : null}
                <Text style={styles.meta}>
                  {item.withdrawnByName} · há{" "}
                  {formatAgo(item.durationSeconds)}
                </Text>
              </Pressable>
            )}
          />
        )}

        {message ? <Text style={styles.message}>{message}</Text> : null}
        <FactoryButton
          label="Atualizar lista"
          variant="secondary"
          onPress={loadPending}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell scroll backToHome>
      {selected ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{selected.product.sku}</Text>
          <Text style={styles.meta}>
            {selected.quantity} un. · origem {selected.fromLocation.label}
          </Text>
        </View>
      ) : null}

      {phase === "scan-gondola" ? (
        <>
          <Text style={styles.instruction}>Bipe a gôndola de destino</Text>
          <FactoryButton
            label="Bipar gôndola"
            onPress={() => setScannerOpen(true)}
            loading={loading}
          />
        </>
      ) : null}

      {phase === "confirm-qty" && selected ? (
        <>
          <Text style={styles.instruction}>
            Gôndola {toBarcode} — confirme a quantidade
          </Text>
          <QuantityInput
            label={`Quantidade (${selected.quantity})`}
            max={selected.quantity}
            onConfirm={confirmDeposit}
          />
          <FactoryButton
            label="Bipar produto (+1)"
            variant="secondary"
            onPress={() => setScannerOpen(true)}
          />
        </>
      ) : null}

      {phase === "done" ? (
        <FactoryButton label="Voltar à lista" onPress={backToList} />
      ) : null}

      {phase !== "done" ? (
        <FactoryButton
          label="Cancelar"
          variant="secondary"
          onPress={backToList}
        />
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <BarcodeScanner
        visible={scannerOpen}
        title={phase === "scan-gondola" ? "Bipar gôndola" : "Bipar produto"}
        onScan={(code) => {
          if (phase === "scan-gondola") handleGondolaScan(code);
        }}
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
  instruction: {
    fontSize: typography.body,
    color: theme.textMuted,
    marginBottom: spacing.sm,
  },
  empty: {
    textAlign: "center",
    color: theme.textMuted,
    marginVertical: spacing.lg,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: theme.border,
  },
  cardTitle: {
    fontSize: typography.title,
    fontWeight: "800",
    color: theme.primary,
  },
  meta: { color: theme.textMuted, marginTop: spacing.xs },
  target: {
    color: theme.info,
    fontWeight: "700",
    marginTop: spacing.xs,
    fontSize: typography.caption,
  },
  message: {
    marginTop: spacing.md,
    color: theme.success,
    fontWeight: "700",
    textAlign: "center",
  },
});
