import { router } from "expo-router";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { Card, EmptyState, Loading, Notice } from "@/components/ui";
import { usePurchaseReceiptQueue } from "@/hooks/usePurchaseReceipt";
import { modules } from "@/lib/modules";
import { theme, spacing, typography } from "@/lib/theme";

export default function PurchaseReceiptEntryScreen() {
  const { data, isLoading, error, refetch, isRefetching } =
    usePurchaseReceiptQueue();

  return (
    <ScreenShell
      module="recebimento"
      title="NF de entrada"
      subtitle={data ? `${data.length} notas no Tiny` : null}
      style={styles.shell}
    >
      <FactoryButton
        label="Bipar DANFE"
        icon="scan"
        color={modules.recebimento.color}
        onPress={() => router.push("/purchase-receipt/scan")}
      />

      {isLoading ? (
        <Loading />
      ) : error ? (
        <Notice tone="danger">
          {error instanceof Error ? error.message : "Erro ao carregar notas"}
        </Notice>
      ) : (
        <FlatList
          style={styles.listWrap}
          data={data ?? []}
          keyExtractor={(item) => String(item.tinyNotaId)}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState icon="document-outline" title="Nenhuma nota" />}
          renderItem={({ item }) => (
            <Card>
              <View style={styles.row}>
                <Text style={styles.numero}>NF {item.invoiceNumber ?? item.tinyNotaId}</Text>
                {item.issueDate ? <Text style={styles.meta}>{item.issueDate}</Text> : null}
              </View>
              {item.supplierName ? (
                <Text style={styles.supplier} numberOfLines={1}>
                  {item.supplierName}
                </Text>
              ) : null}
            </Card>
          )}
        />
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  listWrap: { flex: 1, minHeight: 120 },
  list: { paddingBottom: spacing.xl, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  numero: { fontWeight: "900", fontSize: typography.subtitle, color: theme.text },
  supplier: { color: theme.textMuted, fontWeight: "600", marginTop: 2 },
  meta: { color: theme.textMuted, fontSize: typography.caption, fontWeight: "700" },
});
