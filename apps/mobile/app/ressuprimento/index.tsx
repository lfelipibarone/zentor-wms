import { useCallback, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { PercentInput } from "@/components/PercentInput";
import {
  PulmaoWithdrawPercent,
  type PulmaoWithdrawResult,
} from "@/components/PulmaoWithdrawPercent";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import {
  Badge,
  BigCode,
  Card,
  EmptyState,
  Field,
  Loading,
  OptionRow,
  OrDivider,
  SectionTitle,
  Steps,
} from "@/components/ui";
import {
  api,
  ApiError,
  type CargoTransferSummary,
  type LocationLookup,
  type ProductLocationOption,
  type ReplenishmentNeed,
} from "@/lib/api";
import { showErrorAlert, showToast } from "@/lib/app-alert";
import { modules } from "@/lib/modules";
import { pulmaoPercentOf, pulmaoStocksSummary } from "@/lib/pulmao";
import { theme, spacing, typography, radius } from "@/lib/theme";

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
  /** Gôndola bipada no depósito; falta informar a % que ela ficou */
  const [depositBarcode, setDepositBarcode] = useState<string | null>(null);

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
      showToast(`Aceito · gôndola ${need.routeLabel}`);
    } catch (e) {
      showErrorAlert(apiErr(e, "Erro ao aceitar"));
    } finally {
      setLoading(false);
    }
  };

  const openTransfer = (t: CargoTransferSummary) => {
    setActiveTransfer(t);
    setPhase("deposit");
    showToast(
      `${t.product.sku} → bipar gôndola${t.targetPickFace ? ` ${t.targetPickFace.label}` : ""}`,
    );
  };

  const searchPulmaoBySku = async () => {
    if (!selected || !skuDraft.trim()) return;
    setLoading(true);
    try {
      const res = await api.listProductLocations(skuDraft.trim(), "PULMAO");
      setProductImageUrl(res.product.imageUrl ?? null);
      setPulmaoOptions(res.locations);
      showToast(`${res.locations.length} pulmão(ões) encontrado(s)`);
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
      if (selected && pulmaoPercentOf(full, selected.productId) <= 0) {
        showErrorAlert(`Pulmão ${full.barcode} não tem ${selected.sku}`);
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
      if (pulmaoPercentOf(loc, selected.productId) <= 0) {
        showErrorAlert(`Pulmão ${loc.barcode} não tem ${selected.sku} (${pulmaoStocksSummary(loc)})`);
        return;
      }
      setPulmao(loc);
    } catch (e) {
      showErrorAlert(apiErr(e, "Pulmão não encontrado"));
    } finally {
      setLoading(false);
    }
  };

  const confirmWithdraw = async ({ remainingPercent, skuFinished }: PulmaoWithdrawResult) => {
    if (!selected || !pulmao) return;
    setLoading(true);
    try {
      const result = await api.withdrawCargoTransfer({
        fromLocationBarcode: pulmao.barcode,
        productBarcode: selected.sku,
        remainingPercent,
        skuFinished,
        targetPickFaceId: selected.pickFaceId,
      });
      setActiveTransfer(result.transfer);
      setDepositBarcode(null);
      setPhase("deposit");
      showToast(
        result.fromLocation.skuPercent === 0
          ? `Em trânsito · ${selected.sku} saiu do pulmão ${result.fromLocation.barcode}`
          : `Em trânsito · ${selected.sku} ficou com ${result.fromLocation.skuPercent}% no pulmão`,
      );
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

  const chooseDepositGondola = async (toBarcode: string) => {
    setLoading(true);
    try {
      const loc = await api.getLocationByBarcode(toBarcode);
      if (loc.type !== "PICK_FACE") {
        showErrorAlert("Bipe uma gôndola do estoque de giro");
        return;
      }
      setDepositBarcode(loc.barcode);
      setFaceOptions([]);
    } catch (e) {
      showErrorAlert(apiErr(e, "Gôndola não encontrada"));
    } finally {
      setLoading(false);
    }
  };

  const confirmDeposit = async (percent: number) => {
    if (!activeTransfer || !depositBarcode) return;
    setLoading(true);
    try {
      const result = await api.depositCargoTransfer(activeTransfer.id, {
        toLocationBarcode: depositBarcode,
        productBarcode: activeTransfer.product.sku,
        percent,
      });
      setPhase("done");
      showToast(`Reabastecido · gôndola ${result.toLocation.barcode} em ${result.toLocation.fillPercent}%`);
      setSelected(null);
      setActiveTransfer(null);
      setPulmao(null);
      setDepositBarcode(null);
    } catch (e) {
      showErrorAlert(apiErr(e, "Erro no depósito"));
    } finally {
      setLoading(false);
    }
  };

  const handleGondolaScan = async (raw: string) => {
    setScannerOpen(false);
    await chooseDepositGondola(normalizeBarcode(raw));
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
      showToast("Transporte cancelado");
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
    setDepositBarcode(null);
    void load();
  };

  if (phase === "list") {
    const listHeader =
      myTransfers.length > 0 ? (
        <View style={styles.listHeader}>
          <SectionTitle>Em trânsito comigo</SectionTitle>
          {myTransfers.map((t) => (
            <Card key={t.id} accent={theme.warning} onPress={() => openTransfer(t)}>
              <View style={styles.productRow}>
                <ProductThumbnail imageUrl={t.product.imageUrl} alt={t.product.name} size={56} />
                <View style={styles.productInfo}>
                  <Text style={styles.sku}>{t.product.sku}</Text>
                  <Text style={styles.name} numberOfLines={1}>
                    {t.product.name}
                  </Text>
                  <View style={styles.routeRow}>
                    <Text style={styles.routeText} numberOfLines={1}>
                      {t.fromLocation.label}
                    </Text>
                    <Ionicons name="arrow-forward" size={14} color={theme.textMuted} />
                    <Text style={[styles.routeText, styles.routeTarget]} numberOfLines={1}>
                      {t.targetPickFace?.label ?? "gôndola"}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={24} color={theme.textSoft} />
              </View>
            </Card>
          ))}
          <SectionTitle>Fila</SectionTitle>
        </View>
      ) : null;

    return (
      <ScreenShell
        module="ressuprimento"
        title="Ressuprimento"
        subtitle={loadingList ? null : `${needs.length} gôndolas abaixo do mínimo`}
        style={styles.listShell}
      >
        {loadingList ? (
          <Loading />
        ) : (
          <FlatList
            style={styles.listFlex}
            data={needs}
            keyExtractor={(item) => item.pickFaceId}
            contentContainerStyle={styles.listContent}
            refreshing={false}
            onRefresh={load}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={
              <EmptyState icon="checkmark-done-circle-outline" title="Nenhuma gôndola para repor" />
            }
            renderItem={({ item }) => {
              const busy = Boolean(item.assignedToName && !item.isMine);
              return (
                <Card
                  accent={item.isMine ? theme.warning : busy ? theme.borderStrong : color}
                  muted={busy}
                >
                  <View style={styles.needTop}>
                    <Text style={styles.needLoc} numberOfLines={1}>
                      {item.routeLabel}
                    </Text>
                    <FillGauge fill={item.fillPercent} min={item.minPercent} />
                  </View>
                  <View style={styles.productRow}>
                    <ProductThumbnail imageUrl={item.imageUrl} alt={item.productName} size={48} />
                    <View style={styles.productInfo}>
                      <Text style={styles.sku}>{item.sku}</Text>
                      <Text style={styles.name} numberOfLines={1}>
                        {item.productName}
                      </Text>
                    </View>
                  </View>
                  {busy ? (
                    <Badge label={item.assignedToName ?? ""} icon="person" />
                  ) : item.isMine ? (
                    <FactoryButton
                      label="Continuar"
                      icon="play"
                      size="md"
                      color={theme.warning}
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
                      icon="hand-left"
                      size="md"
                      color={color}
                      onPress={() => acceptNeed(item)}
                      loading={loading}
                    />
                  ) : null}
                </Card>
              );
            }}
          />
        )}
      </ScreenShell>
    );
  }

  if (phase === "withdraw" && selected) {
    const pulmaoPct = pulmao ? pulmaoPercentOf(pulmao, selected.productId) : 0;

    return (
      <ScreenShell
        scroll
        module="ressuprimento"
        title="Retirar do pulmão"
        subtitle={`Para ${selected.routeLabel}`}
      >
        <Steps steps={["Retirar", "Depositar"]} current={0} color={color} />
        <Card>
          <View style={styles.productRow}>
            <ProductThumbnail
              imageUrl={selected.imageUrl ?? productImageUrl}
              alt={selected.productName}
              size={64}
            />
            <View style={styles.productInfo}>
              <Text style={styles.sku}>{selected.sku}</Text>
              <Text style={styles.name} numberOfLines={2}>
                {selected.productName}
              </Text>
            </View>
          </View>
        </Card>

        {!pulmao ? (
          <>
            {selected.suggestedPulmao ? (
              <Badge
                label={`Sugerido: ${selected.suggestedPulmao.label} · ${selected.suggestedPulmao.percent}%`}
                tone="warning"
                icon="star"
              />
            ) : null}
            <FactoryButton
              label="Bipar pulmão"
              icon="scan"
              color={color}
              onPress={() => {
                setScanTarget("pulmao");
                setScannerOpen(true);
              }}
            />
            <OrDivider label="ou busque pelo SKU" />
            <View style={styles.searchRow}>
              <Field
                style={styles.flex}
                value={skuDraft}
                onChangeText={setSkuDraft}
                placeholder={selected.sku}
                autoCapitalize="characters"
              />
              <FactoryButton
                label="Buscar"
                icon="search"
                size="md"
                variant="secondary"
                onPress={searchPulmaoBySku}
                loading={loading}
              />
            </View>
            {pulmaoOptions.map((loc) => (
              <OptionRow
                key={loc.id}
                title={loc.label}
                meta={`${loc.fillPercent}% deste SKU`}
                highlight={loc.isSuggested}
                onPress={() => void pickPulmao(loc)}
              />
            ))}
          </>
        ) : (
          <>
            <BigCode
              label="Pulmão"
              code={pulmao.label}
              color={modules.armazenagem.color}
            />
            <PulmaoWithdrawPercent
              sku={selected.sku}
              pulmaoLabel={pulmao.label}
              currentPercent={pulmaoPct}
              loading={loading}
              onConfirm={confirmWithdraw}
            />
          </>
        )}

        <FactoryButton
          label="Cancelar aceite"
          icon="close"
          size="sm"
          variant="ghost"
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
      <ScreenShell scroll module="ressuprimento" title="Depositar na gôndola">
        <Steps steps={["Retirar", "Depositar"]} current={1} color={color} />
        <Card>
          <View style={styles.productRow}>
            <ProductThumbnail
              imageUrl={activeTransfer.product.imageUrl}
              alt={activeTransfer.product.name}
              size={64}
            />
            <View style={styles.productInfo}>
              <Text style={styles.sku}>{activeTransfer.product.sku}</Text>
              <Text style={styles.name} numberOfLines={2}>
                {activeTransfer.product.name}
              </Text>
              <Text style={styles.meta}>De {activeTransfer.fromLocation.label}</Text>
            </View>
          </View>
        </Card>

        {activeTransfer.targetPickFace ? (
          <BigCode label="Levar para" code={activeTransfer.targetPickFace.label} color={color} />
        ) : null}

        {depositBarcode ? (
          <>
            <PercentInput
              label={`Gôndola ${depositBarcode} — quanto ficou?`}
              initialValue={100}
              resetKey={depositBarcode}
              confirmLabel="Confirmar depósito"
              loading={loading}
              onConfirm={confirmDeposit}
            />
            <FactoryButton
              label="Trocar gôndola"
              icon="swap-horizontal"
              size="sm"
              variant="secondary"
              onPress={() => setDepositBarcode(null)}
            />
          </>
        ) : (
          <>
            <FactoryButton
              label="Bipar gôndola"
              icon="scan"
              color={color}
              onPress={() => {
                setScanTarget("gondola");
                setScannerOpen(true);
              }}
            />
            <OrDivider label="ou busque pelo SKU" />
            <View style={styles.searchRow}>
              <Field
                style={styles.flex}
                value={skuDraft}
                onChangeText={setSkuDraft}
                placeholder={activeTransfer.product.sku}
                autoCapitalize="characters"
              />
              <FactoryButton
                label="Buscar"
                icon="search"
                size="md"
                variant="secondary"
                onPress={searchFaceBySku}
              />
            </View>
            {faceOptions.map((loc) => (
              <OptionRow
                key={loc.id}
                title={loc.label}
                meta={`Gôndola em ${loc.fillPercent}%`}
                highlight={loc.isSuggested}
                onPress={() => void chooseDepositGondola(loc.barcode)}
              />
            ))}
          </>
        )}

        <FactoryButton
          label="Cancelar transporte"
          icon="close"
          size="sm"
          variant="ghost"
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
    <ScreenShell scroll module="ressuprimento" title="Concluído">
      <EmptyState icon="checkmark-circle" title="Gôndola reabastecida" />
      <FactoryButton label="Voltar à fila" icon="arrow-back" color={color} onPress={resetAll} />
    </ScreenShell>
  );
}

/** Barra de ocupação da gôndola com a marca do mínimo */
function FillGauge({ fill, min }: { fill: number; min: number }) {
  const barColor = fill <= min / 2 ? theme.danger : theme.warning;
  return (
    <View style={styles.gaugeWrap}>
      <View style={styles.gauge}>
        <View style={[styles.gaugeFill, { width: `${Math.min(100, fill)}%`, backgroundColor: barColor }]} />
        <View style={[styles.gaugeMin, { left: `${Math.min(100, min)}%` }]} />
      </View>
      <Text style={[styles.gaugeText, { color: barColor }]}>{fill}%</Text>
    </View>
  );
}

const color = modules.ressuprimento.color;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listShell: { paddingBottom: 0 },
  listFlex: { flex: 1 },
  listHeader: { gap: spacing.sm, marginBottom: spacing.xs },
  listContent: { paddingBottom: spacing.xl * 2, gap: spacing.sm, flexGrow: 1 },
  needTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  needLoc: { flex: 1, fontSize: typography.subtitle, fontWeight: "900", color: theme.text },
  productRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", marginVertical: spacing.sm },
  productInfo: { flex: 1, gap: 2 },
  sku: { fontWeight: "900", color: theme.info },
  name: { color: theme.text, fontWeight: "600" },
  meta: { color: theme.textMuted, fontSize: typography.caption, fontWeight: "700" },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  routeText: { color: theme.textMuted, fontWeight: "800", fontSize: typography.caption, flexShrink: 1 },
  routeTarget: { color },
  searchRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  gaugeWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  gauge: {
    width: 70,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: theme.border,
    overflow: "hidden",
  },
  gaugeFill: { height: "100%" },
  gaugeMin: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: theme.text },
  gaugeText: { fontWeight: "900", fontSize: typography.caption },
});
