import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getCollectionUrgency } from "@wms/shared";
import { typography } from "@/lib/theme";

type Props = {
  deadline: string | null | undefined;
  compact?: boolean;
};

/** Pílula com o horário da coleta na cor da urgência */
export function CollectionDeadlineRow({ deadline, compact }: Props) {
  const urgency = getCollectionUrgency(deadline);
  if (!urgency.hasDeadline) return null;

  const urgent = urgency.level === "overdue" || urgency.level === "critical";

  return (
    <View
      style={[styles.pill, { backgroundColor: `${urgency.dotColor}1F` }]}
      accessibilityLabel={urgency.hint}
    >
      <Ionicons name="time" size={14} color={urgency.dotColor} />
      <Text style={[styles.time, { color: urgency.dotColor }]} numberOfLines={1}>
        {urgency.timeLabel}
        {!compact && urgent ? ` · ${urgency.isOverdue ? "atrasado" : "urgente"}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  time: {
    fontWeight: "800",
    fontSize: typography.small + 1,
  },
});
