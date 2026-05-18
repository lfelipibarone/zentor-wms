"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ADMIN_NAV, MAIN_NAV } from "@/lib/nav";
import { useAuth } from "@/components/auth/auth-provider";
import { Permission } from "@wms/shared";

export function Sidebar() {
  const pathname = usePathname();
  const { user, can } = useAuth();

  const mainItems = MAIN_NAV.filter((item) => can(item.permission));
  const adminItems = ADMIN_NAV.filter((item) => can(item.permission));

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-[#0f172a] text-slate-100">
      <div className="border-b border-slate-700/80 px-5 py-5">
        <p className="text-lg font-bold tracking-tight text-white">Help Route</p>
        <p className="mt-1 text-xs text-slate-400">WMS · Operações</p>
      </div>

      {user ? (
        <div className="border-b border-slate-700/80 px-5 py-4 text-sm">
          <p className="text-slate-400">Usuário</p>
          <p className="font-medium text-white">{user.name}</p>
          <p className="truncate text-xs text-slate-500">{user.email}</p>
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-0.5">
          {mainItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-[#0d9488] text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-90" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        {adminItems.length > 0 ? (
          <>
            <p className="mb-2 mt-6 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Administração
            </p>
            <ul className="space-y-0.5">
              {adminItems.map((item) => {
                const active = pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                        active
                          ? "bg-[#0d9488] text-white"
                          : "text-slate-300 hover:bg-slate-800 hover:text-white",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </nav>

    </aside>
  );
}
