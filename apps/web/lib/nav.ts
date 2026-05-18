import { Permission, type PermissionKey } from "@wms/shared";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Box,
  ClipboardList,
  LayoutDashboard,
  Package,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  Truck,
  Users,
  Warehouse,
  Link2,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: PermissionKey;
  badge?: string;
}

export const MAIN_NAV: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: Permission.DASHBOARD_VIEW,
  },
  {
    href: "/pesquisa",
    label: "Pesquisa rápida",
    icon: Search,
    permission: Permission.SEARCH_USE,
  },
  {
    href: "/cadastros",
    label: "Cadastros",
    icon: ClipboardList,
    permission: Permission.REGISTERS_VIEW,
  },
  {
    href: "/produtos",
    label: "Produtos",
    icon: Package,
    permission: Permission.PRODUCTS_MANAGE,
  },
  {
    href: "/vendas",
    label: "Vendas",
    icon: ShoppingCart,
    permission: Permission.SALES_VIEW,
  },
  {
    href: "/recebimentos",
    label: "Recebimentos",
    icon: Box,
    permission: Permission.RECEIPTS_VIEW,
    badge: "beta",
  },
  {
    href: "/estoque",
    label: "Estoque",
    icon: Warehouse,
    permission: Permission.STOCK_VIEW,
  },
  {
    href: "/expedicao",
    label: "Expedição",
    icon: Truck,
    permission: Permission.SHIPPING_VIEW,
  },
  {
    href: "/relatorios",
    label: "Relatórios",
    icon: BarChart3,
    permission: Permission.REPORTS_VIEW,
  },
  {
    href: "/sistema",
    label: "Sistema",
    icon: Settings,
    permission: Permission.SYSTEM_VIEW,
  },
  {
    href: "/integracoes/olist",
    label: "Olist",
    icon: Link2,
    permission: Permission.OLIST_CONFIGURE,
  },
];

export const ADMIN_NAV: NavItem[] = [
  {
    href: "/admin/usuarios",
    label: "Usuários e permissões",
    icon: Users,
    permission: Permission.USERS_MANAGE,
  },
  {
    href: "/admin/configuracoes",
    label: "Configurações",
    icon: Shield,
    permission: Permission.SETTINGS_MANAGE,
  },
];
