import { theme } from "@/lib/theme";

/** Opções de header compartilhadas — seta de voltar sem texto (evita "index") */
export const appStackScreenOptions = {
  headerStyle: { backgroundColor: theme.headerBg },
  headerTintColor: theme.headerTint,
  headerTitleStyle: {
    fontWeight: "800" as const,
    fontSize: 18,
    color: theme.headerTint,
  },
  headerBackButtonDisplayMode: "minimal" as const,
  headerShadowVisible: false,
  headerBackTitle: "",
  contentStyle: { backgroundColor: theme.bg },
  animation: "slide_from_right" as const,
};
