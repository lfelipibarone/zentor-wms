import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import {
  api,
  ApiError,
  type CargoTransferSummary,
  type LocationLookup,
  type ProductLocationOption,
  type ReplenishmentNeed,
} from "@/lib/api";
import { showErrorAlert, showInfoAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";

function apiErr(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

type Phase =
  | "list"
  | "withdraw"
  | "deposit"
  | "done";

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

export default function RessuprimentoScreen() {
  const [phase, setPhase] = useState<Phase>("list");
  const [needs, setNeeds] = useState<ReplenishmentNeed[]>([]);
  const [myTransfers, setMyTransfers] = useState<CargoTransferSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selected, setSelected] = useState<ReplenishmentNeed | null>(null);
  const [activeTransfer, setActiveTransfer] =
    useState<CargoTransferSummary | null>(null);
  const [pulmao, setPulmao] = useState<LocationLookup | null>(null);
  const [skuDraft, setSkuDraft] = useState("");
  const [pulmaoOptions, setPulmaoOptions] = useState<ProductLocationOption[]>([]);
  const [faceOptions, setFaceOptions] = useState<ProductLocationOption[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState<"pulmao" | "gondola">("pulmao");
  const [loading, setLoading] = useState(false);
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadingList(true);
    try {
      const [needsRes, pendingRes] = await Promise.all([
        api.listReplenishmentNeeds(),
        api.listPendingCargoTransfers(),
      ]);
      setNeeds(needsRes.needs);
      setMyTransfers(pendingRes.transfers);
    } catch (e) {
      showErrorAlert(apiErr(e, "Erro ao carregar"));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (phase === "list") void load();
    }, [phase, load]),
  );

  const acceptNeed = async (need: ReplenishmentNeed) => {
    setLoading(true);
    try {
      await api.acceptReplenishmentNeed(need.pickFaceId);
      setProductImageUrl(need.imageUrl ?? null);
      setSelected({ ...need, isMine: true, canWork: true });
      setPhase("withdraw");
      showInfoAlert(`Aceito · gôndola ${need.routeLabel}`);
    } catch (e) {
      showErrorAlert(apiErr(e, "Erro ao aceitar"));
    } finally {
      setLoading(false);
    }
  };

  const openTransfer = (t: CargoTransferSummary) => {
    setActiveTransfer(t);
    setPhase("deposit");
    showInfoAlert(
      `${t.product.sku} · ${t.quantity} un. → bipar gôndola${t.targetPickFace ? ` ${t.targetPickFace.label}` : ""}`,
    );
  };

  const searchPulmaoBySku = async () => {
    if (!selected || !skuDraft.trim()) return;
    setLoading(true);
    try {
      const res = await api.listProductLocations(skuDraft.trim(), "PULMAO");
      setProductImageUrl(res.product.imageUrl ?? null);
      setPulmaoOptions(res.locations);
      showInfoAlert(`${res.locations.length} pulmão(ões) encontrado(s)`);
    } catch (e) {
      showErrorAlert(apiErr(e, "SKU não encontrado"));
    } finally {
      setLoading(false);
    }
  };

  const pickPulmao = async (loc: ProductLocationOption) => {
    setLoading(true);
    try {
      const full = await api.getLocationByBarcode(loc.barcode);
      if (full.type !== "PULMAO") {
        showErrorAlert("Selecione um pulmão");
        return;
      }
      setPulmao(full);
      setPulmaoOptions([]);
    } catch (e) {
      showErrorAlert(apiErr(e, "Erro"));
    } finally {
      setLoading(false);
    }
  };

  const handlePulmaoScan = async (raw: string) => {
    setScannerOpen(false);
    if (!selected) return;
    setLoading(true);
    try {
      const loc = await api.getLocationByBarcode(normalizeBarcode(raw));
      if (loc.type !== "PULMAO") {
        showErrorAlert("Bipe um pulmão");
        return;
      }
      if (loc.product?.id && loc.product.id !== selected.productId) {
        showErrorAlert("Produto não corresponde");
        return;
      }
      setPulmao(loc);
    } catch (e) {
      showErrorAlert(apiErr(e, "Pulmão não encontrado"));
    } finally {
      setLoading(false);
    }
  };

  const confirmWithdraw = async (qty: number) => {
    if (!selected || !pulmao) return;
    setLoading(true);
    try {
      const result = await api.withdrawCargoTransfer({
        fromLocationBarcode: pulmao.barcode,
        productBarcode: pulmao.product?.sku ?? selected.sku,
        quantity: qty,
        targetPickFaceId: selected.pickFaceId,
      });
      setActiveTransfer(result.transfer);
      setPhase("deposit");
      showInfoAlert(`Em trânsito · ${result.transfer.quantity} un.`);
    } catch (e) {
      showErrorAlert(apiErr(e, "Erro na retirada"));
    } finally {
      setLoading(false);
    }
  };

  const searchFaceBySku = async () => {
    if (!activeTransfer || !skuDraft.trim()) return;
    setLoading(true);
    try {
      const res = await api.listProductLocations(skuDraft.trim(), "PICK_FACE");
      setFaceOptions(res.locations);
    } catch (e) {
      showErrorAlert(apiErr(e, "Erro"));
    } finally {
      setLoading(false);
    }
  };

  const confirmDeposit = async (toBarcode: string) => {
    if (!activeTransfer) return;
    setLoading(true);
    try {
      await api.depositCargoTransfer(activeTransfer.id, {
        toLocationBarcode: toBarcode,
        productBarcode: activeTransfer.product.sku,
        quantity: activeTransfer.quantity,
      });
      setPhase("done");
      showInfoAlert("Reabastecimento concluído");
      setSelected(null);
      setActiveTransfer(null);
      setPulmao(null);
    } catch (e) {
      showErrorAlert(apiErr(e, "Erro no depósito"));
    } finally {
      setLoading(false);
    }
  };

  const handleGondolaScan = async (raw: string) => {
    setScannerOpen(false);
    await confirmDeposit(normalizeBarcode(raw));
  };

  const cancelTransit = async () => {
    if (!activeTransfer) return;
    setLoading(true);
    try {
      await api.cancelCargoTransfer(activeTransfer.id);
      if (selected) {
        await api.releaseReplenishmentNeed(selected.pickFaceId).catch(() => {});
      }
      resetAll();
      showInfoAlert("Transporte cancelado");
    } catch (e) {
      showErrorAlert(apiErr(e, "Erro ao cancelar"));
    } finally {
      setLoading(false);
    }
  };

  const resetAll = () => {
    setPhase("list");
    setSelected(null);
    setActiveTransfer(null);
    setPulmao(null);
    setPulmaoOptions([]);
    setFaceOptions([]);
    setSkuDraft("");
    setProductImageUrl(null);
    void load();
  };

  if (phase === "list") {
    const listHeader = (
      <View style={styles.listHeader}>
        {myTransfers.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Meus em trânsito</Text>
            {myTransfers.map((t) => (
              <Pressable
                key={t.id}
                style={styles.card}
                onPress={() => openTransfer(t)}
              >
                <View style={styles.productRow}>
                  <ProductThumbnail
                    imageUrl={t.product.imageUrl}
                    alt={t.product.name}
                    size={72}
                  />
                  <View style={styles.productInfo}>
                    <Text style={styles.sku}>{t.product.sku}</Text>
                    <Text style={styles.name}>{t.product.name}</Text>
                    <Text style={styles.meta}>
                      {t.quantity} un. · {t.fromLocation.label}
                    </Text>
                    {t.targetPickFace ? (
                      <Text style={styles.meta}>
                        → {t.targetPickFace.label}
                      </Text>
                    ) : null}
                    <Text style={styles.tapHint}>TOQUE PARA DEPOSITAR</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text style={styles.sectionTitle}>Fila de reabastecimento</Text>
      </View>
    );

    return (
      <ScreenShell backToHome title="Ressuprimento" style={styles.listShell}>
        {loadingList ? (
          <View style={styles.listLoading}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>
        ) : (
          <FlatList
            style={styles.listFlex}
            data={needs}
            keyExtractor={(item) => item.pickFaceId}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
              <Text style={styles.empty}>Nenhuma necessidade aberta</Text>
            }
            ListFooterComponent={
              <FactoryButton
                label="Atualizar"
                variant="secondary"
                onPress={load}
              />
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.productRow}>
                  <ProductThumbnail
                    imageUrl={item.imageUrl}
                    alt={item.productName}
                    size={72}
                  />
                  <View style={styles.productInfo}>
                    <Text style={styles.sku}>{item.sku}</Text>
                    <Text style={styles.name}>{item.productName}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {item.routeLabel} · {item.currentQuantity}/{item.minThreshold}{" "}
                  · repor ~{item.deficit}
                </Text>
                {item.assignedToName && !item.isMine ? (
                  <Text style={styles.warn}>
                    Em andamento: {item.assignedToName}
                  </Text>
                ) : null}
                {item.isMine ? (
                  <FactoryButton
                    label="Continuar"
                    onPress={() => {
                      setSelected(item);
                      setProductImageUrl(item.imageUrl ?? null);
                      setPhase(
                        item.assignmentStatus === "WITHDRAWN"
                          ? "deposit"
                          : "withdraw",
                      );
                    }}
                  />
                ) : item.canAccept ? (
                  <FactoryButton
                    label="Aceitar"
                    onPress={() => acceptNeed(item)}
                    loading={loading}
                  />
                ) : null}
              </View>
            )}
          />
        )}
      </ScreenShell>
    );
  }

  if (phase === "withdraw" && selected) {
    const maxQty = pulmao
      ? Math.min(pulmao.currentQuantity, selected.deficit)
      : selected.deficit;

    return (
      <ScreenShell scroll backToHome title="Retirar do pulmão">
        <View style={styles.card}>
          <Text style={styles.meta}>Gôndola alvo: {selected.routeLabel}</Text>
          <View style={styles.productRow}>
            <ProductThumbnail
              imageUrl={selected.imageUrl ?? productImageUrl ?? pulmao?.product?.imageUrl}
              alt={selected.productName}
            />
            <View style={styles.productInfo}>
              <Text style={styles.sku}>{selected.sku}</Text>
              <Text style={styles.name}>{selected.productName}</Text>
            </View>
          </View>
        </View>

        {!pulmao ? (
          <>
            <FactoryButton
              label="Bipar pulmão"
              onPress={() => {
                setScanTarget("pulmao");
                setScannerOpen(true);
              }}
            />
            <Text style={styles.or}>ou informe o SKU</Text>
            <TextInput
              style={styles.input}
              value={skuDraft}
              onChangeText={setSkuDraft}
              placeholder="SKU / código"
              autoCapitalize="characters"
            />
            <FactoryButton
              label="Buscar pulmões"
              variant="secondary"
              onPress={searchPulmaoBySku}
              loading={loading}
            />
            {pulmaoOptions.map((loc) => (
              <Pressable
                key={loc.id}
                style={styles.optionRow}
                onPress={() => pickPulmao(loc)}
              >
                <Text style={styles.optionLabel}>
                  {loc.label}
                  {loc.isSuggested ? " ★" : ""}
                </Text>
                <Text style={styles.meta}>{loc.currentQuantity} un.</Text>
              </Pressable>
            ))}
          </>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.locTitle}>{pulmao.label}</Text>
              <Text style={styles.meta}>Saldo: {pulmao.currentQuantity}</Text>
            </View>
            <QuantityInput
              label={`Quantidade (máx. ${maxQty})`}
              max={maxQty}
              onConfirm={confirmWithdraw}
            />
          </>
        )}

        <FactoryButton
          label="Cancelar aceite"
          variant="secondary"
          onPress={async () => {
            await api.releaseReplenishmentNeed(selected.pickFaceId).catch(() => {});
            resetAll();
          }}
        />
        <BarcodeScanner
          visible={scannerOpen}
          title="Bipar pulmão"
          onScan={handlePulmaoScan}
          onClose={() => setScannerOpen(false)}
        />
      </ScreenShell>
    );
  }

  if (phase === "deposit" && activeTransfer) {
    return (
      <ScreenShell scroll backToHome title="Depositar na gôndola">
        <View style={styles.card}>
          <View style={styles.productRow}>
            <ProductThumbnail
              imageUrl={activeTransfer.product.imageUrl}
              alt={activeTransfer.product.name}
            />
            <View style={styles.productInfo}>
              <Text style={styles.sku}>{activeTransfer.product.sku}</Text>
              <Text style={styles.name}>{activeTransfer.product.name}</Text>
              <Text style={styles.meta}>
                {activeTransfer.quantity} un. em trânsito
              </Text>
              {activeTransfer.targetPickFace ? (
                <Text style={styles.locTitle}>
                  {activeTransfer.targetPickFace.label}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <FactoryButton
          label="Bipar gôndola"
          onPress={() => {
            setScanTarget("gondola");
            setScannerOpen(true);
          }}
        />
        <Text style={styles.or}>ou SKU para listar gôndolas</Text>
        <TextInput
          style={styles.input}
          value={skuDraft}
          onChangeText={setSkuDraft}
          placeholder="SKU"
          autoCapitalize="characters"
        />
        <FactoryButton
          label="Buscar gôndolas"
          variant="secondary"
          onPress={searchFaceBySku}
        />
        {faceOptions.map((loc) => (
          <Pressable
            key={loc.id}
            style={styles.optionRow}
            onPress={() => confirmDeposit(loc.barcode)}
          >
            <Text style={styles.optionLabel}>
              {loc.label}
              {loc.isSuggested ? " ★" : ""}
            </Text>
            <Text style={styles.meta}>{loc.currentQuantity} un.</Text>
          </Pressable>
        ))}

        <FactoryButton
          label="Cancelar transporte"
          variant="secondary"
          onPress={cancelTransit}
          loading={loading}
        />
        <BarcodeScanner
          visible={scannerOpen}
          title="Bipar gôndola"
          onScan={handleGondolaScan}
          onClose={() => setScannerOpen(false)}
        />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell scroll backToHome title="Concluído">
      <Text style={styles.doneText}>Operação finalizada</Text>
      <FactoryButton label="Voltar à fila" onPress={resetAll} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  listShell: {
    gap: 0,
    paddingBottom: 0,
  },
  listFlex: { flex: 1 },
  listLoading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listHeader: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  listContent: {
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  doneText: {
    textAlign: "center",
    fontSize: typography.body,
    color: theme.text,
    marginBottom: spacing.md,
  },
  tapHint: {
    marginTop: spacing.xs,
    fontWeight: "800",
    color: theme.primary,
    fontSize: typography.caption,
  },
  section: { marginBottom: spacing.md },
  sectionTitle: { fontWeight: "800", marginBottom: spacing.sm },
  empty: { color: theme.textMuted, textAlign: "center" },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: theme.border,
  },
  productRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
    marginBottom: spacing.sm,
  },
  productInfo: { flex: 1, gap: spacing.xs },
  sku: { fontWeight: "900", color: theme.info },
  name: { color: theme.text },
  meta: { color: theme.textMuted, fontSize: typography.caption, marginTop: 4 },
  warn: { color: theme.danger, fontSize: typography.caption },
  locTitle: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.primary,
  },
  or: { textAlign: "center", color: theme.textMuted, marginVertical: spacing.sm },
  input: {
    borderWidth: 2,
    borderColor: theme.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  optionRow: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  optionLabel: { fontWeight: "700" },
});
