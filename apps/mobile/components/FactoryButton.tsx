import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type ViewStyle,
} from "react-native";
import { theme } from "@/lib/theme";

type Variant = "primary" | "success" | "danger" | "secondary";

interface FactoryButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

const variantStyles: Record<
  Variant,
  { bg: string; text: string; border?: string }
> = {
  primary: { bg: theme.primary, text: theme.primaryText },
  success: { bg: theme.success, text: theme.successText },
  danger: { bg: theme.danger, text: theme.dangerText },
  secondary: {
    bg: theme.surfaceElevated,
    text: theme.text,
    border: theme.border,
  },
};

export function FactoryButton({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
}: FactoryButtonProps) {
  const v = variantStyles[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg, borderColor: v.border ?? v.bg },
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text} size="large" />
      ) : (
        <Text style={[styles.label, { color: v.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 64,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
