import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { FactoryButton } from "./FactoryButton";
import { theme, spacing, typography, radius } from "@/lib/theme";

interface QuantityInputProps {
  label: string;
  /** Sem máximo (ex.: pulmão, que não tem limite de unidades) */
  max?: number;
  onConfirm: (qty: number) => void;
  loading?: boolean;
  /** Permite confirmar 0 (ex.: gôndola vazia na solicitação de reabastecimento). */
  allowZero?: boolean;
  confirmLabel?: string;
}

export function QuantityInput({
  label,
  max,
  onConfirm,
  loading,
  allowZero = false,
  confirmLabel = "Confirmar",
}: QuantityInputProps) {
  const [value, setValue] = useState("");

  const parsed = parseInt(value, 10);
  const valid =
    !Number.isNaN(parsed) &&
    (max === undefined || parsed <= max) &&
    (allowZero ? parsed >= 0 : parsed > 0);

  const quick = [1, 5, 10].filter((n) => max === undefined || n < max);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, valid && styles.inputValid]}
        value={value}
        onChangeText={setValue}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={theme.textSoft}
        maxLength={6}
      />
      <View style={styles.quickRow}>
        {quick.map((n) => (
          <Chip key={n} label={String(n)} active={parsed === n} onPress={() => setValue(String(n))} />
        ))}
        {max !== undefined ? (
          <Chip
            label={`Tudo · ${max}`}
            active={parsed === max}
            wide
            onPress={() => setValue(String(max))}
          />
        ) : null}
      </View>
      <FactoryButton
        label={confirmLabel}
        icon="checkmark"
        variant="success"
        disabled={!valid}
        loading={loading}
        onPress={() => onConfirm(parsed)}
      />
    </View>
  );
}

export function Chip({
  label,
  active,
  wide,
  onPress,
}: {
  label: string;
  active?: boolean;
  wide?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        wide && styles.chipWide,
        active && styles.chipActive,
        pressed && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  label: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 2,
    borderColor: theme.borderStrong,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    fontSize: 44,
    fontWeight: "900",
    color: theme.text,
    textAlign: "center",
  },
  inputValid: { borderColor: theme.success },
  quickRow: { flexDirection: "row", gap: spacing.sm },
  chip: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: theme.borderStrong,
    backgroundColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  chipWide: { flex: 2 },
  chipActive: { backgroundColor: theme.text, borderColor: theme.text },
  chipPressed: { opacity: 0.8 },
  chipText: { fontSize: typography.body, fontWeight: "900", color: theme.text },
  chipTextActive: { color: "#fff" },
});
