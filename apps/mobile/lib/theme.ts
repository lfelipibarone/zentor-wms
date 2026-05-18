/** Paleta alinhada ao painel web Help Route */
export const theme = {
  /** Fundo das telas (slate-50) */
  bg: "#F8FAFC",
  /** Cards e superfícies */
  surface: "#FFFFFF",
  surfaceElevated: "#F1F5F9",
  border: "#E2E8F0",
  text: "#0F172A",
  textMuted: "#64748B",
  /** Teal principal — mesmo do web */
  primary: "#0D9488",
  primaryDark: "#0B7D73",
  primaryText: "#FFFFFF",
  /** Header estilo sidebar web */
  headerBg: "#0F172A",
  headerTint: "#FFFFFF",
  success: "#22C55E",
  successText: "#FFFFFF",
  danger: "#EF4444",
  dangerText: "#FFFFFF",
  warning: "#F59E0B",
  info: "#38BDF8",
  scannerOverlay: "rgba(13, 148, 136, 0.35)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const typography = {
  hero: 36,
  title: 28,
  subtitle: 20,
  body: 18,
  caption: 14,
} as const;
