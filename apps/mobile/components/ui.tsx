import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { IconName } from "@/lib/modules";
import {
  theme,
  spacing,
  typography,
  radius,
  shadow,
  toneColors,
  type Tone,
} from "@/lib/theme";

/** Card branco padrão; com `accent` ganha uma faixa colorida à esquerda */
export function Card({
  children,
  onPress,
  accent,
  muted,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  accent?: string;
  muted?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const body = (
    <>
      {accent ? <View style={[styles.cardAccent, { backgroundColor: accent }]} /> : null}
      {children}
    </>
  );
  const cardStyle = [styles.card, accent ? styles.cardWithAccent : null, muted && styles.cardMuted, style];
  if (!onPress) return <View style={cardStyle}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [cardStyle, pressed && styles.cardPressed]}
    >
      {body}
    </Pressable>
  );
}

export function Badge({
  label,
  tone = "neutral",
  icon,
  solid,
}: {
  label: string;
  tone?: Tone;
  icon?: IconName;
  /** Fundo forte (status crítico) */
  solid?: boolean;
}) {
  const c = toneColors[tone];
  const solidBg: Record<Tone, string> = {
    neutral: "#475569",
    primary: theme.primary,
    success: theme.success,
    warning: theme.warning,
    danger: theme.danger,
    info: theme.info,
  };
  const bg = solid ? solidBg[tone] : c.bg;
  const fg = solid ? "#fff" : c.fg;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={13} color={fg} /> : null}
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function EmptyState({
  icon = "checkmark-done-circle-outline",
  title,
  action,
}: {
  icon?: IconName;
  title: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={48} color={theme.textSoft} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={theme.primary} />
      {label ? <Text style={styles.loadingText}>{label}</Text> : null}
    </View>
  );
}

const noticeIcon: Record<Tone, IconName> = {
  neutral: "information-circle",
  primary: "information-circle",
  info: "information-circle",
  success: "checkmark-circle",
  warning: "alert-circle",
  danger: "close-circle",
};

/** Faixa de aviso curta (sucesso, alerta, erro) */
export function Notice({
  children,
  tone = "info",
  onClose,
}: {
  children: ReactNode;
  tone?: Tone;
  onClose?: () => void;
}) {
  const c = toneColors[tone];
  return (
    <View style={[styles.notice, { backgroundColor: c.bg }]}>
      <Ionicons name={noticeIcon[tone]} size={20} color={c.fg} />
      <Text style={[styles.noticeText, { color: c.fg }]}>{children}</Text>
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={18} color={c.fg} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={theme.textSoft}
      {...props}
      style={[styles.field, props.style]}
    />
  );
}

export function OrDivider({ label = "ou digite" }: { label?: string }) {
  return (
    <View style={styles.orRow}>
      <View style={styles.orLine} />
      <Text style={styles.orText}>{label}</Text>
      <View style={styles.orLine} />
    </View>
  );
}

/** Código grande (gôndola, pulmão, pedido) para ler de longe */
export function BigCode({
  label,
  code,
  meta,
  color = theme.primary,
}: {
  label?: string;
  code: string;
  meta?: string | null;
  color?: string;
}) {
  return (
    <View style={[styles.bigCode, { backgroundColor: color }]}>
      {label ? <Text style={styles.bigCodeLabel}>{label}</Text> : null}
      <Text style={styles.bigCodeText} adjustsFontSizeToFit numberOfLines={1}>
        {code}
      </Text>
      {meta ? <Text style={styles.bigCodeMeta}>{meta}</Text> : null}
    </View>
  );
}

export function ProgressBar({
  value,
  total,
  color = theme.primary,
}: {
  value: number;
  total: number;
  color?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

/** Abas em pílula, com contador opcional */
export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  dark,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  /** Para usar dentro do cabeçalho escuro */
  dark?: boolean;
}) {
  return (
    <View style={[styles.tabs, dark && styles.tabsDark]}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <Pressable
            key={t.id}
            onPress={() => onChange(t.id)}
            style={[styles.tab, active && (dark ? styles.tabActiveDark : styles.tabActive)]}
          >
            <Text
              style={[
                styles.tabText,
                dark && styles.tabTextDark,
                active && (dark ? styles.tabTextActiveDark : styles.tabTextActive),
              ]}
              numberOfLines={1}
            >
              {t.label}
            </Text>
            {t.count != null && t.count > 0 ? (
              <View style={[styles.tabCount, active && styles.tabCountActive]}>
                <Text style={[styles.tabCountText, active && styles.tabCountTextActive]}>
                  {t.count > 99 ? "99+" : t.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Passos do fluxo (ex.: Pulmão → Qtd → %), com o atual destacado */
export function Steps({
  steps,
  current,
  color = theme.primary,
}: {
  steps: string[];
  current: number;
  color?: string;
}) {
  return (
    <View style={styles.steps}>
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={s} style={styles.step}>
            <View
              style={[
                styles.stepDot,
                (done || active) && { backgroundColor: color, borderColor: color },
              ]}
            >
              {done ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : (
                <Text style={[styles.stepNum, active && styles.stepNumActive]}>{i + 1}</Text>
              )}
            </View>
            <Text
              style={[styles.stepLabel, active && { color: theme.text }]}
              numberOfLines={1}
            >
              {s}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Linha de opção tocável (escolher gôndola, pulmão etc.) */
export function OptionRow({
  title,
  meta,
  onPress,
  highlight,
}: {
  title: string;
  meta?: string | null;
  onPress: () => void;
  highlight?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        highlight && styles.optionHighlight,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.optionText}>
        <Text style={styles.optionTitle}>{title}</Text>
        {meta ? <Text style={styles.optionMeta}>{meta}</Text> : null}
      </View>
      {highlight ? <Ionicons name="star" size={16} color={theme.warning} /> : null}
      <Ionicons name="chevron-forward" size={20} color={theme.textSoft} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: theme.border,
    ...shadow,
  },
  cardWithAccent: { paddingLeft: spacing.md + 4 },
  cardAccent: {
    position: "absolute",
    left: -1,
    top: -1,
    bottom: -1,
    width: 6,
    borderTopLeftRadius: radius.lg,
    borderBottomLeftRadius: radius.lg,
  },
  cardMuted: { opacity: 0.6 },
  cardPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  badgeText: { fontSize: typography.small, fontWeight: "800" },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  sectionTitle: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    fontSize: typography.body,
    fontWeight: "700",
    color: theme.textMuted,
    textAlign: "center",
  },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  loadingText: { color: theme.textMuted, fontWeight: "600" },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  noticeText: { flex: 1, fontWeight: "700", fontSize: typography.caption + 1 },
  field: {
    minWidth: 0,
    borderWidth: 1.5,
    borderColor: theme.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: typography.body,
    fontWeight: "700",
    color: theme.text,
    backgroundColor: theme.surface,
  },
  orRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  orLine: { flex: 1, height: 1, backgroundColor: theme.borderStrong },
  orText: { color: theme.textMuted, fontSize: typography.caption, fontWeight: "600" },
  bigCode: {
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  bigCodeLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: typography.caption,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  bigCodeText: { color: "#fff", fontSize: 34, fontWeight: "900", letterSpacing: 0.5 },
  bigCodeMeta: { color: "rgba(255,255,255,0.9)", fontWeight: "700", marginTop: 2 },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: theme.border,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: radius.pill },
  tabs: {
    flexDirection: "row",
    backgroundColor: theme.border,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  tabsDark: { backgroundColor: "rgba(255,255,255,0.08)" },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: radius.sm + 1,
  },
  tabActive: { backgroundColor: theme.surface, ...shadow },
  tabActiveDark: { backgroundColor: theme.surface },
  tabText: { fontWeight: "800", color: theme.textMuted, fontSize: 15 },
  tabTextDark: { color: theme.headerMuted },
  tabTextActive: { color: theme.text },
  tabTextActiveDark: { color: theme.text },
  tabCount: {
    minWidth: 20,
    paddingHorizontal: 5,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.textSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  tabCountActive: { backgroundColor: theme.primary },
  tabCountText: { color: "#fff", fontSize: 11, fontWeight: "900" },
  tabCountTextActive: { color: "#fff" },
  steps: { flexDirection: "row", gap: spacing.sm },
  step: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.surface,
  },
  stepNum: { fontSize: typography.small, fontWeight: "900", color: theme.textMuted },
  stepNumActive: { color: "#fff" },
  stepLabel: {
    flexShrink: 1,
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.textMuted,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  optionHighlight: { borderColor: theme.warning, backgroundColor: "#FFFBEB" },
  optionText: { flex: 1 },
  optionTitle: { fontWeight: "800", fontSize: typography.body, color: theme.text },
  optionMeta: { color: theme.textMuted, fontSize: typography.caption, marginTop: 2 },
});
