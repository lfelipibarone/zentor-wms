import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { BackButton } from "@/components/BackButton";
import { modules, type ModuleKey } from "@/lib/modules";
import { theme, spacing, typography, radius } from "@/lib/theme";

interface AppHeaderProps {
  title: string;
  subtitle?: string | null;
  module?: ModuleKey;
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  /** Conteúdo extra embaixo do título (abas, filtros) */
  children?: ReactNode;
}

/** Barra escura fixa no topo: voltar + ícone do módulo + título */
export function AppHeader({
  title,
  subtitle,
  module,
  back = true,
  onBack,
  right,
  children,
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const mod = module ? modules[module] : null;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.xs }]}>
      {mod ? <View style={[styles.accent, { backgroundColor: mod.color }]} /> : null}
      <View style={styles.row}>
        {back ? <BackButton onPress={onBack} /> : null}
        {mod ? (
          <View style={[styles.icon, { backgroundColor: mod.color }]}>
            <Ionicons name={mod.icon} size={18} color="#fff" />
          </View>
        ) : null}
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      {children ? <View style={styles.extra}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.headerBg,
    paddingBottom: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
  },
  accent: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  titles: { flex: 1, minWidth: 0 },
  title: {
    color: theme.headerTint,
    fontSize: typography.subtitle,
    fontWeight: "800",
  },
  subtitle: {
    color: theme.headerMuted,
    fontSize: typography.caption,
    fontWeight: "600",
    marginTop: 1,
  },
  right: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  extra: { marginTop: spacing.sm, paddingHorizontal: spacing.xs },
});
