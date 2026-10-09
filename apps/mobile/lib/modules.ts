import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export type ModuleKey =
  | "picking"
  | "recebimento"
  | "armazenagem"
  | "ressuprimento"
  | "gondola"
  | "tarefas"
  | "transporte"
  | "consulta";

export interface ModuleDef {
  label: string;
  icon: IconName;
  color: string;
  /** Fundo claro da mesma cor (chips, cards destacados) */
  soft: string;
}

/** Cada módulo tem cor e ícone próprios para ser reconhecido de longe */
export const modules: Record<ModuleKey, ModuleDef> = {
  picking: { label: "Picking", icon: "cart", color: "#0D9488", soft: "#CCFBF1" },
  recebimento: { label: "Recebimento", icon: "download", color: "#2563EB", soft: "#DBEAFE" },
  armazenagem: { label: "Armazenagem", icon: "archive", color: "#7C3AED", soft: "#EDE9FE" },
  ressuprimento: { label: "Ressuprimento", icon: "swap-vertical", color: "#EA580C", soft: "#FFEDD5" },
  gondola: { label: "Atualizar gôndola", icon: "speedometer", color: "#16A34A", soft: "#DCFCE7" },
  tarefas: { label: "Minhas tarefas", icon: "people", color: "#D97706", soft: "#FEF3C7" },
  transporte: { label: "Transporte", icon: "car", color: "#0891B2", soft: "#CFFAFE" },
  consulta: { label: "Consulta", icon: "search", color: "#475569", soft: "#E2E8F0" },
};
