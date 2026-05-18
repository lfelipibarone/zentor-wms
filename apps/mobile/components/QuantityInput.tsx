import { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FactoryButton } from "./FactoryButton";
import { theme, spacing, typography } from "@/lib/theme";

interface QuantityInputProps {
  label: string;
  max: number;
  onConfirm: (qty: number) => void;
  loading?: boolean;
}

export function QuantityInput({
  label,
  max,
  onConfirm,
  loading,
}: QuantityInputProps) {
  const [value, setValue] = useState("");

  const parsed = parseInt(value, 10);
  const valid = !Number.isNaN(parsed) && parsed > 0 && parsed <= max;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.hint}>Máximo: {max} un.</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={theme.textMuted}
        maxLength={6}
      />
      <View style={styles.quickRow}>
        {[1, 5, 10].filter((n) => n <= max).map((n) => (
          <FactoryButton
            key={n}
            label={`+${n}`}
            variant="secondary"
            onPress={() => setValue(String(n))}
            style={styles.quickBtn}
          />
        ))}
        <FactoryButton
          label="MAX"
          variant="secondary"
          onPress={() => setValue(String(max))}
          style={styles.quickBtn}
        />
      </View>
      <FactoryButton
        label="Confirmar quantidade"
        variant="success"
        disabled={!valid}
        loading={loading}
        onPress={() => onConfirm(parsed)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  label: {
    fontSize: typography.subtitle,
    fontWeight: "800",
    color: theme.text,
  },
  hint: { fontSize: typography.caption, color: theme.textMuted },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 3,
    borderColor: theme.primary,
    borderRadius: 12,
    padding: spacing.lg,
    fontSize: 48,
    fontWeight: "900",
    color: theme.text,
    textAlign: "center",
  },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quickBtn: { flex: 1, minWidth: "45%" as unknown as number, minHeight: 52 },
});
