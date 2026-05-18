import { SafeAreaView } from "react-native-safe-area-context";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from "react-native";
import { theme, spacing, typography } from "@/lib/theme";

interface ScreenShellProps extends ViewProps {
  title?: string;
  subtitle?: string;
  scroll?: boolean;
  children: React.ReactNode;
}

export function ScreenShell({
  title,
  subtitle,
  scroll,
  children,
  style,
  ...rest
}: ScreenShellProps) {
  const content = (
    <>
      {title || subtitle ? (
        <View style={styles.header}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      ) : null}
      {children}
    </>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right", "bottom"]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.container, style]}
          keyboardShouldPersistTaps="handled"
          {...rest}
        >
          {content}
        </ScrollView>
      ) : (
        <View style={[styles.container, style]} {...rest}>
          {content}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  container: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.md,
  },
  header: { gap: spacing.xs, marginBottom: spacing.sm },
  title: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.text,
  },
  subtitle: {
    fontSize: typography.body,
    color: theme.textMuted,
    fontWeight: "600",
  },
});
