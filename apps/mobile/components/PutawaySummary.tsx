import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SectionTitle } from "@/components/ui";
import type { PutawaySessionDto } from "@/lib/api";
import { modules } from "@/lib/modules";
import { theme, spacing, typography, radius } from "@/lib/theme";

type Props = {
  items: PutawaySessionDto["items"];
  title?: string;
};

/** Onde cada SKU da NF foi guardado (um SKU pode ter ido para vários pulmões). */
export function PutawaySummary({ items, title = "Onde foi guardado" }: Props) {
  return (
    <View style={styles.wrap}>
      <SectionTitle>{title}</SectionTitle>
      {items.map((it) => (
        <View key={it.id} style={styles.item}>
          <View style={styles.itemHeader}>
            <Text style={styles.sku}>{it.productCode ?? "—"}</Text>
            <Text style={styles.qty}>
              {it.quantityStored}/{it.quantityExpected} un.
            </Text>
          </View>
          {it.storedLocations.length > 0 ? (
            it.storedLocations.map((loc) => (
              <View key={loc.locationId} style={styles.locRow}>
                <Ionicons name="location" size={16} color={modules.armazenagem.color} />
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
  wrap: { gap: spacing.sm },
  item: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: theme.border,
    gap: 4,
  },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  sku: { fontWeight: "900", fontSize: typography.body, color: theme.text, flexShrink: 1 },
  qty: { fontWeight: "800", fontSize: typography.caption, color: theme.textMuted },
  locRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 4 },
  locLabel: {
    flex: 1,
    fontWeight: "800",
    color: modules.armazenagem.color,
    fontSize: typography.body,
  },
  locQty: { fontWeight: "800", color: theme.text, fontSize: typography.body },
  pending: { color: theme.textMuted, fontSize: typography.caption, fontStyle: "italic" },
});
