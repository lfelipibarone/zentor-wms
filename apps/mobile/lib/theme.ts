/** Paleta alinhada ao painel web Help Route */
export const theme = {
  /** Fundo das telas (slate-100) */
  bg: "#F1F5F9",
  /** Cards e superfícies */
  surface: "#FFFFFF",
  surfaceElevated: "#F8FAFC",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  text: "#0F172A",
  textMuted: "#64748B",
  textSoft: "#94A3B8",
  /** Teal principal — mesmo do web */
  primary: "#0D9488",
  primaryDark: "#0B7D73",
  primarySoft: "#CCFBF1",
  primaryText: "#FFFFFF",
  /** Header estilo sidebar web */
  headerBg: "#0F172A",
  headerTint: "#FFFFFF",
  headerMuted: "#94A3B8",
  success: "#16A34A",
  successSoft: "#DCFCE7",
  successText: "#FFFFFF",
  danger: "#DC2626",
  dangerSoft: "#FEE2E2",
  dangerText: "#FFFFFF",
  warning: "#D97706",
  warningSoft: "#FEF3C7",
  info: "#0284C7",
  infoSoft: "#E0F2FE",
  scannerOverlay: "rgba(13, 148, 136, 0.35)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const typography = {
  hero: 36,
  title: 26,
  subtitle: 20,
  body: 17,
  caption: 14,
  small: 12,
} as const;

/** Sombra leve para cards (iOS + Android) */
export const shadow = {
  shadowColor: "#0F172A",
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

export const toneColors: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "#E2E8F0", fg: "#334155" },
  primary: { bg: theme.primarySoft, fg: "#0F766E" },
  success: { bg: theme.successSoft, fg: "#166534" },
  warning: { bg: theme.warningSoft, fg: "#92400E" },
  danger: { bg: theme.dangerSoft, fg: "#991B1B" },
  info: { bg: theme.infoSoft, fg: "#075985" },
};
