import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { usePurchaseReceiptQueue } from "@/hooks/usePurchaseReceipt";
import { theme, spacing, typography } from "@/lib/theme";

export default function PurchaseReceiptEntryScreen() {
  const { data, isLoading, error, refetch, isRefetching } =
    usePurchaseReceiptQueue();

  return (
    <ScreenShell
      scroll
      title="NF de entrada"
      subtitle="Notas do Tiny aguardando recebimento"
    >
      <FactoryButton
        label="Bipar DANFE"
        onPress={() => router.push("/purchase-receipt/scan")}
      />

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
        </View>
      ) : error ? (
        <Text style={styles.error}>
          {error instanceof Error ? error.message : "Erro ao carregar notas"}
        </Text>
      ) : (
        <>
          <Text style={styles.count}>
            {data?.length ?? 0} nota(s) recentes no Tiny
          </Text>
          <FlatList
            style={styles.listWrap}
            data={data ?? []}
            keyExtractor={(item) => String(item.tinyNotaId)}
            refreshing={isRefetching}
            onRefresh={refetch}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.empty}>Nenhuma nota listada</Text>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <Text style={styles.numero}>
                  NF {item.invoiceNumber ?? item.tinyNotaId}
                </Text>
                {item.supplierName ? (
                  <Text style={styles.supplier}>{item.supplierName}</Text>
                ) : null}
                {item.issueDate ? (
                  <Text style={styles.meta}>Emissão: {item.issueDate}</Text>
                ) : null}
              </View>
            )}
          />
        </>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  listWrap: { flex: 1, minHeight: 120 },
  centered: { padding: spacing.xl, alignItems: "center" },
  count: {
    marginTop: spacing.md,
    color: theme.textMuted,
    fontSize: typography.caption,
  },
  list: { paddingBottom: spacing.xl, gap: spacing.sm },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: theme.border,
  },
  numero: { fontWeight: "800", fontSize: typography.subtitle },
  supplier: { color: theme.textMuted, marginTop: 4 },
  meta: { color: theme.textMuted, fontSize: typography.caption, marginTop: 2 },
  empty: { textAlign: "center", color: theme.textMuted, padding: spacing.lg },
  error: { color: theme.danger, textAlign: "center", padding: spacing.md },
});
