import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { IconName } from "@/lib/modules";
import { theme, radius } from "@/lib/theme";

type Variant = "primary" | "success" | "danger" | "secondary" | "ghost";
type Size = "lg" | "md" | "sm";

interface FactoryButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  /** Cor de fundo customizada (ex.: cor do módulo) para o variant primary */
  color?: string;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

const variantStyles: Record<Variant, { bg: string; text: string; border: string }> = {
  primary: { bg: theme.primary, text: theme.primaryText, border: theme.primary },
  success: { bg: theme.success, text: theme.successText, border: theme.success },
  danger: { bg: theme.danger, text: theme.dangerText, border: theme.danger },
  secondary: { bg: theme.surface, text: theme.text, border: theme.borderStrong },
  ghost: { bg: "transparent", text: theme.primary, border: "transparent" },
};

const sizeStyles: Record<Size, { minHeight: number; font: number; icon: number; padX: number }> = {
  lg: { minHeight: 60, font: 19, icon: 24, padX: 20 },
  md: { minHeight: 50, font: 17, icon: 20, padX: 16 },
  sm: { minHeight: 40, font: 15, icon: 18, padX: 12 },
};

export function FactoryButton({
  label,
  onPress,
  variant = "primary",
  size = "lg",
  icon,
  color,
  disabled,
  loading,
  style,
}: FactoryButtonProps) {
  const v = variantStyles[variant];
  const s = sizeStyles[size];
  const bg = color && variant === "primary" ? color : v.bg;
  const border = color && variant === "primary" ? color : v.border;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: border,
          minHeight: s.minHeight,
          paddingHorizontal: s.padX,
        },
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text} />
      ) : (
        <View style={styles.content}>
          {icon ? <Ionicons name={icon} size={s.icon} color={v.text} /> : null}
          <Text style={[styles.label, { color: v.text, fontSize: s.font }]} numberOfLines={2}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  label: {
    fontWeight: "800",
    textAlign: "center",
    flexShrink: 1,
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
