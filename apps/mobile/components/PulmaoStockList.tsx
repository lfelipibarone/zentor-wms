import { StyleSheet, Text, View } from "react-native";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import type { PulmaoStock } from "@/lib/api";
import { modules } from "@/lib/modules";
import { theme, spacing, typography, radius } from "@/lib/theme";

/** SKUs guardados no pulmão, com a % que cada um ocupa. */
export function PulmaoStockList({ stocks }: { stocks: PulmaoStock[] }) {
  if (stocks.length === 0) {
    return <Text style={styles.empty}>Pulmão vazio</Text>;
  }
  return (
    <View style={styles.wrap}>
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
  wrap: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  info: { flex: 1 },
  sku: { fontWeight: "800", color: theme.text },
  name: { color: theme.textMuted, fontSize: typography.caption },
  qty: { fontWeight: "900", color: modules.armazenagem.color, fontSize: typography.body },
  empty: { color: theme.textMuted, fontSize: typography.caption, fontWeight: "700" },
});
