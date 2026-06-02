import { theme } from "@/lib/theme";

import React from "react";
import { BackButton } from "@/components/BackButton";

/** Header padrão: seta sem texto, volta à tela inicial */
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
  headerBackVisible: false,
  headerLeft: () => React.createElement(BackButton),
  contentStyle: { backgroundColor: theme.bg },
  animation: "slide_from_right" as const,
  animationTypeForReplace: "pop" as const,
};
