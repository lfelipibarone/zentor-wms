import { View, Text, StyleSheet } from "react-native";
import { getCollectionUrgency } from "@wms/shared";
import { theme, spacing, typography } from "@/lib/theme";

type Props = {
  deadline: string | null | undefined;
  compact?: boolean;
};

export function CollectionDeadlineRow({ deadline, compact }: Props) {
  const urgency = getCollectionUrgency(deadline);

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <View
        style={[styles.dot, { backgroundColor: urgency.dotColor }]}
        accessibilityLabel={urgency.hint}
      />
      <Text style={[styles.time, compact && styles.timeCompact]} numberOfLines={1}>
        {urgency.timeLabel}
      </Text>
      {!compact ? (
        <Text style={styles.hint} numberOfLines={1}>
          {urgency.hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
    flexWrap: "wrap",
  },
  rowCompact: { marginTop: 0 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  time: {
    fontWeight: "800",
    fontSize: typography.caption,
    color: theme.text,
  },
  timeCompact: { fontSize: typography.caption },
  hint: {
    flex: 1,
    fontSize: typography.caption,
    color: theme.textMuted,
    fontWeight: "600",
  },
});
