"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isPlatformOnlyAdmin } from "@wms/shared";
import { useAuth } from "@/components/auth/auth-provider";

const ALLOWED_PREFIXES = ["/platform", "/login"];

const OPERATIONAL_PREFIXES = [
  "/cadastros",
  "/pedidos",
  "/ondas",
  "/recebimentos",
  "/estoque-giro",
  "/packing",
  "/sistema",
  "/integracoes",
  "/relatorios",
  "/admin",
];

function isOperationalPath(pathname: string): boolean {
  if (pathname === "/") return false;
  return OPERATIONAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function PlatformRouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user || !isPlatformOnlyAdmin(user)) return;
    if (ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return;
    }
    if (isOperationalPath(pathname)) {
      router.replace("/platform/tenants");
    }
  }, [user, loading, pathname, router]);

  return <>{children}</>;
}
