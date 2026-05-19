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

export default function PurchaseReceiptListScreen() {
  const { data, isLoading, error, refetch, isRefetching } =
    usePurchaseReceiptQueue();

  return (
    <ScreenShell
      backToHome
      title="Recebimento"
      style={styles.shell}
      subtitle="Notas de entrada (Tiny) aguardando recebimento"
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
  list: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: theme.border,
  },
  numero: { fontWeight: "800", fontSize: typography.body, color: theme.text },
  supplier: { marginTop: 4, color: theme.text },
  meta: { marginTop: 4, color: theme.textMuted, fontSize: typography.caption },
  error: { color: theme.danger, marginTop: spacing.md },
  empty: { textAlign: "center", color: theme.textMuted, marginTop: spacing.lg },
});
