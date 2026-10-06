import { StyleSheet, Text, View } from "react-native";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import type { PulmaoStock } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

/** SKUs guardados no pulmão, com a % que cada um ocupa. */
export function PulmaoStockList({ stocks }: { stocks: PulmaoStock[] }) {
  if (stocks.length === 0) {
    return <Text style={styles.empty}>Pulmão vazio</Text>;
  }
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>
        {stocks.length} SKU{stocks.length > 1 ? "s" : ""} neste pulmão
      </Text>
      {stocks.map((s) => (
        <View key={s.product.id} style={styles.row}>
          <ProductThumbnail imageUrl={s.product.imageUrl} alt={s.product.name} size={40} />
          <View style={styles.info}>
            <Text style={styles.sku}>{s.product.sku}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {s.product.name}
            </Text>
          </View>
          <Text style={styles.qty}>{s.percent}%</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, marginTop: spacing.sm },
  title: { fontWeight: "800", color: theme.text, fontSize: typography.caption },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  info: { flex: 1 },
  sku: { fontWeight: "800", color: theme.text },
  name: { color: theme.textMuted, fontSize: typography.caption },
  qty: { fontWeight: "900", color: theme.primary },
  empty: { color: theme.textMuted, fontSize: typography.caption, marginTop: spacing.sm },
});
