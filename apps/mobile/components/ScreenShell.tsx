import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, StyleSheet, View, type ViewProps } from "react-native";
import { AppHeader } from "@/components/AppHeader";
import type { ModuleKey } from "@/lib/modules";
import { theme, spacing } from "@/lib/theme";

/** Padding horizontal padrão das telas com ScreenShell */
export const screenPadding = spacing.md;

interface ScreenShellProps extends ViewProps {
  title?: string;
  subtitle?: string | null;
  /** Cor e ícone do módulo no cabeçalho */
  module?: ModuleKey;
  /** Conteúdo rolável quando passa da altura da tela */
  scroll?: boolean;
  /** Seta de voltar no cabeçalho (padrão: sim) */
  back?: boolean;
  onBack?: () => void;
  headerRight?: ReactNode;
  /** Conteúdo fixo logo abaixo do título (abas, filtros) */
  headerExtra?: ReactNode;
  children: ReactNode;
}

export function ScreenShell({
  title,
  subtitle,
  module,
  scroll = false,
  back = true,
  onBack,
  headerRight,
  headerExtra,
  children,
  style,
  ...rest
}: ScreenShellProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.md };

  return (
    <View style={styles.root}>
      {title ? (
        <AppHeader
          title={title}
          subtitle={subtitle}
          module={module}
          back={back}
          onBack={onBack}
          right={headerRight}
        >
          {headerExtra}
        </AppHeader>
      ) : (
        <View style={{ height: insets.top, backgroundColor: theme.headerBg }} />
      )}
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, bottomPad, style]}
          keyboardShouldPersistTaps="always"
          showsVerticalScrollIndicator={false}
          {...rest}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.container, bottomPad, style]} {...rest}>
          {children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  container: {
    flex: 1,
    padding: screenPadding,
    gap: spacing.md,
  },
  scrollContent: {
    flexGrow: 1,
    padding: screenPadding,
    gap: spacing.md,
  },
});
