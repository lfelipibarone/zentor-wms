import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { FactoryButton } from "./FactoryButton";
import { Chip } from "./QuantityInput";
import { isQuantityMode, parsePercentText, parseUnitsText } from "@/lib/percent";
import type { StockModeFields } from "@/lib/api";
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

interface UnitsInputProps {
  label: string;
  hint?: string;
  initialValue?: number | null;
  resetKey?: string | number;
  /** Unidades que enchem a gôndola (100%) */
  capacity?: number | null;
  minQuantity?: number | null;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: (units: number) => void;
  children?: ReactNode;
}

/** Contagem em unidades para gôndolas medidas por quantidade. */
export function UnitsInput({
  label,
  hint,
  initialValue,
  resetKey,
  capacity,
  minQuantity,
  confirmLabel = "Confirmar unidades",
  loading,
  onConfirm,
  children,
}: UnitsInputProps) {
  const [value, setValue] = useState(initialValue != null ? String(initialValue) : "");

  useEffect(() => {
    setValue(initialValue != null ? String(initialValue) : "");
  }, [resetKey, initialValue]);

  const parsed = parseUnitsText(value);
  const cap = capacity && capacity > 0 ? capacity : null;
  const fill = cap && parsed !== null ? Math.min(100, Math.round((parsed * 100) / cap)) : 0;
  const low = parsed !== null && minQuantity != null && parsed <= minQuantity;
  const quick = Array.from(
    new Set([0, minQuantity ?? null, cap ? Math.round(cap / 2) : null, cap].filter(
      (n): n is number => n !== null && n >= 0,
    )),
  ).sort((a, b) => a - b);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={[styles.inputRow, parsed !== null && styles.inputRowValid]}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={(t) => setValue(t.replace(/[^0-9]/g, "").slice(0, 5))}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={theme.textSoft}
          maxLength={5}
        />
        <Text style={styles.suffix}>un.</Text>
      </View>
      {cap ? (
        <View style={styles.gauge}>
          <View
            style={[
              styles.gaugeFill,
              { width: `${fill}%`, backgroundColor: low ? theme.danger : theme.success },
            ]}
          />
        </View>
      ) : null}
      {cap || minQuantity != null ? (
        <Text style={styles.hint}>
          {[cap ? `Cheia: ${cap} un.` : null, minQuantity != null ? `Mínimo: ${minQuantity} un.` : null]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
      <View style={styles.quickRow}>
        {quick.map((n) => (
          <Chip key={n} label={`${n}`} active={parsed === n} onPress={() => setValue(String(n))} />
        ))}
      </View>
      {children}
      <FactoryButton
        label={confirmLabel}
        icon="checkmark"
        variant="success"
        disabled={parsed === null}
        loading={loading}
        onPress={() => parsed !== null && onConfirm(parsed)}
      />
    </View>
  );
}

export type GondolaLevel = { percent: number } | { quantity: number };

/**
 * Pergunta o nível da gôndola no modo dela: unidades (por quantidade) ou % (padrão).
 * `onConfirm` devolve `{ quantity }` ou `{ percent }` para mandar direto à API.
 */
export function GondolaLevelInput({
  location,
  percentLabel,
  unitsLabel = "Quantas unidades tem agora?",
  hint,
  resetKey,
  initialPercent,
  initialUnits,
  confirmLabel,
  loading,
  onConfirm,
  children,
}: {
  location: StockModeFields & { fillPercent?: number | null };
  percentLabel: string;
  unitsLabel?: string;
  hint?: string;
  resetKey?: string | number;
  initialPercent?: number | null;
  /** Padrão: as unidades registradas hoje */
  initialUnits?: number | null;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: (level: GondolaLevel) => void;
  children?: ReactNode;
}) {
  if (isQuantityMode(location)) {
    return (
      <UnitsInput
        label={unitsLabel}
        hint={hint}
        resetKey={resetKey}
        initialValue={initialUnits !== undefined ? initialUnits : (location.stockQuantity ?? null)}
        capacity={location.capacity}
        minQuantity={location.minQuantity}
        confirmLabel={confirmLabel ?? "Confirmar unidades"}
        loading={loading}
        onConfirm={(quantity) => onConfirm({ quantity })}
      >
        {children}
      </UnitsInput>
    );
  }
  return (
    <PercentInput
      label={percentLabel}
      hint={hint}
      resetKey={resetKey}
      initialValue={initialPercent}
      confirmLabel={confirmLabel}
      loading={loading}
      onConfirm={(percent) => onConfirm({ percent })}
    >
      {children}
    </PercentInput>
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
