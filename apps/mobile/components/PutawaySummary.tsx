import { StyleSheet, Text, View } from "react-native";
import type { PutawaySessionDto } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

type Props = {
  items: PutawaySessionDto["items"];
  title?: string;
};

/** Onde cada SKU da NF foi guardado (um SKU pode ter ido para vários pulmões). */
export function PutawaySummary({ items, title = "Onde foi guardado" }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {items.map((it) => (
        <View key={it.id} style={styles.item}>
          <View style={styles.itemHeader}>
            <Text style={styles.sku}>{it.productCode ?? "—"}</Text>
            <Text style={styles.qty}>
              {it.quantityStored}/{it.quantityExpected} un.
            </Text>
          </View>
          {it.description ? <Text style={styles.desc}>{it.description}</Text> : null}
          {it.storedLocations.length > 0 ? (
            it.storedLocations.map((loc) => (
              <View key={loc.locationId} style={styles.locRow}>
                <Text style={styles.locLabel}>{loc.label}</Text>
                <Text style={styles.locQty}>{loc.quantity} un.</Text>
              </View>
            ))
          ) : (
            <Text style={styles.pending}>Ainda não guardado</Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginBottom: spacing.md },
  title: {
    fontSize: typography.subtitle,
    fontWeight: "900",
    color: theme.text,
  },
  item: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 4,
  },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  sku: { fontWeight: "900", fontSize: typography.body, color: theme.text, flexShrink: 1 },
  qty: { fontWeight: "800", fontSize: typography.caption, color: theme.textMuted },
  desc: { color: theme.textMuted, fontSize: typography.caption },
  locRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingTop: 4,
  },
  locLabel: { fontWeight: "800", color: theme.primary, fontSize: typography.body, flexShrink: 1 },
  locQty: { fontWeight: "800", color: theme.text, fontSize: typography.body },
  pending: { color: theme.textMuted, fontSize: typography.caption, fontStyle: "italic" },
});
