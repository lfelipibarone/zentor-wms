import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { FactoryButton } from "./FactoryButton";
import { Chip } from "./QuantityInput";
import { parsePercentText } from "@/lib/percent";
import { theme, spacing, typography, radius } from "@/lib/theme";

const QUICK_PERCENTS = [0, 25, 50, 75, 100];

interface PercentInputProps {
  label: string;
  hint?: string;
  /** Valor inicial (ex.: 100 após reposição) */
  initialValue?: number | null;
  /** Muda para reiniciar o campo com `initialValue` */
  resetKey?: string | number;
  /** Menor % aceita (ex.: 1 ao guardar no pulmão) */
  minPercent?: number;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: (percent: number) => void;
  /** Conteúdo entre os botões rápidos e o confirmar */
  children?: ReactNode;
}

export function PercentInput({
  label,
  hint,
  initialValue,
  resetKey,
  minPercent = 0,
  confirmLabel = "Confirmar %",
  loading,
  onConfirm,
  children,
}: PercentInputProps) {
  const [value, setValue] = useState(initialValue != null ? String(initialValue) : "");

  useEffect(() => {
    setValue(initialValue != null ? String(initialValue) : "");
  }, [resetKey, initialValue]);

  const parsed = parsePercentText(value);
  const valid = parsed !== null && parsed >= minPercent;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={[styles.inputRow, valid && styles.inputRowValid]}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={(t) => setValue(t.replace(/[^0-9]/g, "").slice(0, 3))}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={theme.textSoft}
          maxLength={3}
        />
        <Text style={styles.suffix}>%</Text>
      </View>
      <View style={styles.gauge}>
        <View
          style={[
            styles.gaugeFill,
            {
              width: `${parsed ?? 0}%`,
              backgroundColor:
                (parsed ?? 0) <= 25 ? theme.danger : (parsed ?? 0) <= 50 ? theme.warning : theme.success,
            },
          ]}
        />
      </View>
      <View style={styles.quickRow}>
        {QUICK_PERCENTS.filter((n) => n >= minPercent).map((n) => (
          <Chip key={n} label={`${n}`} active={parsed === n} onPress={() => setValue(String(n))} />
        ))}
      </View>
      {value !== "" && parsed === null ? (
        <Text style={styles.error}>De 0 a 100</Text>
      ) : null}
      {children}
      <FactoryButton
        label={confirmLabel}
        icon="checkmark"
        variant="success"
        disabled={!valid}
        loading={loading}
        onPress={() => parsed !== null && onConfirm(parsed)}
      />
    </View>
  );
}

/** Campo de % enxuto para listas (vários SKUs na mesma tela). */
export function CompactPercentField({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  const parsed = parsePercentText(value);
  return (
    <View style={styles.compactWrap}>
      <View style={styles.compactInputRow}>
        <TextInput
          style={styles.compactInput}
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9]/g, "").slice(0, 3))}
          keyboardType="number-pad"
          placeholder="—"
          placeholderTextColor={theme.textMuted}
          maxLength={3}
        />
        <Text style={styles.compactSuffix}>%</Text>
      </View>
      <View style={styles.compactQuick}>
        {[25, 50, 75, 100].map((n) => (
          <Pressable
            key={n}
            onPress={() => onChange(String(n))}
            style={[styles.compactChip, parsed === n && styles.compactChipActive]}
          >
            <Text style={[styles.compactChipText, parsed === n && styles.compactChipTextActive]}>
              {n}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compactWrap: { gap: spacing.xs, alignItems: "flex-end" },
  compactInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: theme.primary,
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    backgroundColor: theme.surface,
  },
  compactInput: {
    minWidth: 52,
    paddingVertical: spacing.xs,
    fontSize: typography.subtitle,
    fontWeight: "900",
    color: theme.text,
    textAlign: "center",
  },
  compactSuffix: { fontWeight: "900", color: theme.textMuted },
  compactQuick: { flexDirection: "row", gap: 4 },
  compactChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceElevated,
  },
  compactChipActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  compactChipText: { fontWeight: "800", color: theme.text, fontSize: typography.caption },
  compactChipTextActive: { color: theme.primaryText },
  wrap: { gap: spacing.sm },
  label: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  hint: { fontSize: typography.caption, color: theme.textMuted, fontWeight: "600" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderWidth: 2,
    borderColor: theme.borderStrong,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  inputRowValid: { borderColor: theme.success },
  input: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 44,
    fontWeight: "900",
    color: theme.text,
    textAlign: "center",
  },
  suffix: { fontSize: 32, fontWeight: "900", color: theme.textMuted },
  gauge: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: theme.border,
    overflow: "hidden",
  },
  gaugeFill: { height: "100%", borderRadius: radius.pill },
  quickRow: { flexDirection: "row", gap: spacing.sm },
  error: { color: theme.danger, fontWeight: "700" },
});
